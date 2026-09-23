from __future__ import annotations

from rgbd_workbench.domain.contracts import DepthSpec, capability_report
from tests.python.test_contracts import manifest


def test_scene_without_depth_semantics_remains_image_inspectable():
    scene = manifest(depth_spec=None)
    report = capability_report(scene, [])

    assert report.image_inspection is True
    assert report.relative_pointcloud is False
    assert report.metric_pointcloud is False
    assert report.video_export is False


def test_metric_depth_scale_is_explicit_and_stable():
    spec = DepthSpec(representation="z_depth", scale_to_meter=0.001)
    assert spec.scale_to_meter == 0.001


def test_knn_parameters_are_structured_and_bounded():
    from rgbd_workbench.domain.contracts import KNNFilterSpec, KNNSmoothSpec

    assert KNNFilterSpec().k == 16
    assert KNNSmoothSpec(k=8).k == 8

    try:
        KNNFilterSpec(k=100)
    except ValueError:
        pass
    else:
        raise AssertionError("KNN k above the supported range must fail")
