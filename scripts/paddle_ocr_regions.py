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


_OCRS = {}


def get_ocr(lang):
    if lang not in _OCRS:
        _OCRS[lang] = PaddleOCR(
            lang=lang,
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


def predict_text(ocr, processed):
    try:
        prediction = ocr.predict(processed)
        text = extract_text(prediction)
        if text:
            return text
    except Exception:
        pass

    fd, temp_path = tempfile.mkstemp(suffix=".png")
    os.close(fd)
    try:
        cv2.imwrite(temp_path, processed)
        attempts = [
            lambda: ocr.predict(temp_path),
            lambda: ocr.ocr(temp_path),
            lambda: ocr.ocr(processed),
        ]

        for attempt in attempts:
            try:
                prediction = attempt()
                text = extract_text(prediction)
                if text:
                    return text
            except TypeError:
                continue
            except Exception:
                continue

        return ""
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
            text = predict_text(ocr, processed)
        except Exception as exc:
            text = f"__OCR_ERROR__ {exc}"

        result["regions"].append(
            {
                "name": region["name"],
                "text": text,
                "image": encode_png(crop),
                "processedImage": encode_png(processed),
            }
        )

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
    main()
