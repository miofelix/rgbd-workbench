from __future__ import annotations

import io

from PIL import Image

from rgbd_workbench.adapters.image import probe_rgb


def test_nondefault_exif_orientation_blocks_metric_geometry(tmp_path):
    output = io.BytesIO()
    image = Image.new("RGB", (2, 2), (10, 20, 30))
    exif = image.getexif()
    exif[274] = 6
    image.save(output, format="JPEG", exif=exif.tobytes())
    path = tmp_path / "rotated.jpg"
    path.write_bytes(output.getvalue())

    candidate = probe_rgb(path)
    orientation = [
        item
        for item in candidate.diagnostics
        if item.code == "RGB_ORIENTATION_CONFIRMATION_REQUIRED"
    ]
    assert orientation and orientation[0].severity == "fatal"
