def test_package_version_and_console_module_are_importable():
    from rgbd_workbench.version import APP_VERSION

    assert APP_VERSION == "0.1.0"
