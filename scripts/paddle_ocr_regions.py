#!/usr/bin/env python3

import base64
import json
import os
import sys
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
        return thresholded
    if mode == "map":
        scaled = cv2.resize(gray, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
        return cv2.equalizeHist(scaled)
    scaled = cv2.resize(gray, None, fx=2.5, fy=2.5, interpolation=cv2.INTER_CUBIC)
    return cv2.GaussianBlur(scaled, (3, 3), 0)


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
    for item in ocr_result:
        if isinstance(item, dict):
            texts.extend(item.get("rec_texts", []))
    return "\n".join([text for text in texts if text]).strip()


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
            prediction = ocr.predict(processed)
            text = extract_text(prediction)
        except Exception as exc:
            text = f"__OCR_ERROR__ {exc}"

        result["regions"].append(
            {
                "name": region["name"],
                "text": text,
                "image": encode_png(crop),
                "processedImage": encode_png(processed if len(processed.shape) == 2 else cv2.cvtColor(processed, cv2.COLOR_BGR2GRAY)),
            }
        )

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
    main()
