#!/usr/bin/env python3

import base64
import json
import os
import sys
import tempfile
from pathlib import Path

import cv2
from paddleocr import PaddleOCR


def encode_png(image):
    ok, buffer = cv2.imencode(".png", image)
    if not ok:
      return ""
    return "data:image/png;base64," + base64.b64encode(buffer.tobytes()).decode("ascii")


def clamp(value, min_value, max_value):
    return max(min_value, min(value, max_value))


def crop_region(image, region):
    height, width = image.shape[:2]
    left = clamp(int(round(width * region["left"])), 0, width - 1)
    top = clamp(int(round(height * region["top"])), 0, height - 1)
    crop_width = clamp(int(round(width * region["width"])), 1, width - left)
    crop_height = clamp(int(round(height * region["height"])), 1, height - top)
    return image[top : top + crop_height, left : left + crop_width]


def preprocess(image, mode):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    if mode in {"score", "stats"}:
        scaled = cv2.resize(gray, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
        _, thresholded = cv2.threshold(scaled, 155, 255, cv2.THRESH_BINARY)
        return cv2.cvtColor(thresholded, cv2.COLOR_GRAY2BGR)
    if mode == "map":
        scaled = cv2.resize(gray, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
        return cv2.cvtColor(cv2.equalizeHist(scaled), cv2.COLOR_GRAY2BGR)
    scaled = cv2.resize(gray, None, fx=2.5, fy=2.5, interpolation=cv2.INTER_CUBIC)
    return cv2.cvtColor(cv2.GaussianBlur(scaled, (3, 3), 0), cv2.COLOR_GRAY2BGR)


def upscale(image, factor):
    return cv2.resize(image, None, fx=factor, fy=factor, interpolation=cv2.INTER_CUBIC)


_OCRS = {}


def env_int(name, default):
    value = os.getenv(name)
    if not value:
        return default

    try:
        return int(value)
    except ValueError:
        return default


def env_bool(name, default):
    value = os.getenv(name)
    if value is None:
        return default

    return value.strip().lower() in {"1", "true", "yes", "on"}


def get_ocr(lang):
    if lang not in _OCRS:
        _OCRS[lang] = PaddleOCR(
            lang=lang,
            device="cpu",
            enable_mkldnn=False,
            cpu_threads=env_int("PADDLE_OCR_CPU_THREADS", 4),
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
        )
    return _OCRS[lang]


def extract_text(ocr_result):
    texts = []

    def collect(value):
        if value is None:
            return

        if isinstance(value, str):
            text = value.strip()
            if text:
                texts.append(text)
            return

        if isinstance(value, dict):
            rec_texts = value.get("rec_texts")
            if isinstance(rec_texts, list):
                for text in rec_texts:
                    collect(text)

            for key in ("text", "label"):
                if key in value:
                    collect(value[key])

            if "res" in value:
                collect(value["res"])
            return

        if isinstance(value, (list, tuple)):
            if len(value) == 2 and isinstance(value[1], (list, tuple)) and value[1]:
                collect(value[1][0])
                return

            for item in value:
                collect(item)
            return

        for attr in ("rec_texts", "texts", "text"):
            if hasattr(value, attr):
                collect(getattr(value, attr))

    collect(ocr_result)
    return "\n".join([text for text in texts if text]).strip()


def score_text(text):
    if not text:
        return 0

    compact = "".join(text.split())
    alnum = sum(1 for char in compact if char.isalnum())
    lines = len([line for line in text.splitlines() if line.strip()])
    return len(compact) + alnum * 2 + lines * 4


def preview_texts(ocr_result):
    texts = extract_text(ocr_result).splitlines()
    return [text for text in texts if text][:20]


def try_predict(ocr, payload):
    fast_mode = env_bool("PADDLE_OCR_FAST_MODE", True)
    attempts = [lambda: ocr.predict(payload)]
    if not fast_mode:
        attempts.append(lambda: ocr.ocr(payload))

    best_text = ""
    best_score = 0
    debug_attempts = []

    for index, attempt in enumerate(attempts):
        try:
            prediction = attempt()
            text = extract_text(prediction)
            text_score = score_text(text)
            debug_attempts.append(
                {
                    "method": "predict" if index == 0 else "ocr",
                    "text": text,
                    "score": text_score,
                    "tokens": preview_texts(prediction),
                }
            )
            if text_score > best_score:
                best_text = text
                best_score = text_score
        except TypeError:
            debug_attempts.append(
                {
                    "method": "predict" if index == 0 else "ocr",
                    "error": "TypeError",
                }
            )
            continue
        except Exception as exc:
            debug_attempts.append(
                {
                    "method": "predict" if index == 0 else "ocr",
                    "error": str(exc),
                }
            )
            continue

    return best_text, debug_attempts


def predict_text(ocr, images):
    fd, temp_path = tempfile.mkstemp(suffix=".png")
    os.close(fd)
    try:
        best_text = ""
        best_score = 0
        best_source = None
        debug_attempts = []

        fast_mode = env_bool("PADDLE_OCR_FAST_MODE", True)

        for source_name, image in images:
            text, source_attempts = try_predict(ocr, image)
            text_score = score_text(text)
            debug_attempts.append(
                {
                    "source": source_name,
                    "input": "array",
                    "attempts": source_attempts,
                }
            )
            if text_score > best_score:
                best_text = text
                best_score = text_score
                best_source = f"{source_name}:array"

            if not fast_mode:
                cv2.imwrite(temp_path, image)
                text, source_attempts = try_predict(ocr, temp_path)
                text_score = score_text(text)
                debug_attempts.append(
                    {
                        "source": source_name,
                        "input": "path",
                        "attempts": source_attempts,
                    }
                )
                if text_score > best_score:
                    best_text = text
                    best_score = text_score
                    best_source = f"{source_name}:path"

        return best_text, {
            "bestSource": best_source,
            "bestScore": best_score,
            "attempts": debug_attempts,
        }
    finally:
        try:
            os.unlink(temp_path)
        except OSError:
            pass


def main():
    if len(sys.argv) != 3:
        print(json.dumps({"error": "Usage: paddle_ocr_regions.py <image> <manifest>"}))
        sys.exit(1)

    image_path = Path(sys.argv[1])
    manifest_path = Path(sys.argv[2])

    image = cv2.imread(str(image_path))
    if image is None:
        print(json.dumps({"error": "Failed to read image"}))
        sys.exit(1)

    manifest = json.loads(manifest_path.read_text())
    regions = manifest["regions"]

    result = {"regions": []}
    for region in regions:
        crop = crop_region(image, region)
        processed = preprocess(crop, region.get("mode", "names"))
        lang = region.get("lang", "ru")
        text = ""
        debug = {
            "mode": region.get("mode", "names"),
            "lang": lang,
            "cropSize": [int(crop.shape[1]), int(crop.shape[0])],
            "processedSize": [int(processed.shape[1]), int(processed.shape[0])],
            "fastMode": env_bool("PADDLE_OCR_FAST_MODE", True),
        }
        try:
            ocr = get_ocr(lang)
            images = [("crop", crop)]
            if region.get("mode", "names") == "stats":
                images.append(("processed", processed))
            elif region.get("mode", "names") == "map":
                images.append(("processed", processed))
            else:
                images.append(("enlargedCrop", upscale(crop, 1.5)))

            text, ocr_debug = predict_text(
                ocr,
                images,
            )
            debug["ocr"] = ocr_debug
        except Exception as exc:
            text = f"__OCR_ERROR__ {exc}"
            debug["error"] = str(exc)

        result["regions"].append(
            {
                "name": region["name"],
                "text": text,
                "image": encode_png(crop),
                "processedImage": encode_png(processed),
                "debug": debug,
            }
        )

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
    main()
