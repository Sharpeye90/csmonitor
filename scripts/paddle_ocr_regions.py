#!/usr/bin/env python3

import json
import os
import sys
import tempfile
from pathlib import Path

import cv2
from paddleocr import PaddleOCR


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


def try_predict(ocr, payload):
    fast_mode = env_bool("PADDLE_OCR_FAST_MODE", True)
    attempts = [lambda: ocr.predict(payload)]
    if not fast_mode:
        attempts.append(lambda: ocr.ocr(payload))

    best_text = ""
    best_score = 0

    for attempt in attempts:
        try:
            prediction = attempt()
            text = extract_text(prediction)
            text_score = score_text(text)
            if text_score > best_score:
                best_text = text
                best_score = text_score
        except TypeError:
            continue
        except Exception:
            continue

    return best_text


def predict_text(ocr, images):
    fd, temp_path = tempfile.mkstemp(suffix=".png")
    os.close(fd)
    try:
        best_text = ""
        best_score = 0

        fast_mode = env_bool("PADDLE_OCR_FAST_MODE", True)

        for _, image in images:
            text = try_predict(ocr, image)
            text_score = score_text(text)
            if text_score > best_score:
                best_text = text
                best_score = text_score

            if not fast_mode:
                cv2.imwrite(temp_path, image)
                text = try_predict(ocr, temp_path)
                text_score = score_text(text)
                if text_score > best_score:
                    best_text = text
                    best_score = text_score

        return best_text
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
        try:
            ocr = get_ocr(lang)
            images = [("crop", crop)]
            if region.get("mode", "names") == "stats":
                images.append(("processed", processed))
            elif region.get("mode", "names") == "map":
                images.append(("processed", processed))
            else:
                images.append(("enlargedCrop", upscale(crop, 1.5)))

            text = predict_text(ocr, images)
        except Exception:
            text = ""

        result["regions"].append(
            {
                "name": region["name"],
                "text": text,
            }
        )

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
    main()
