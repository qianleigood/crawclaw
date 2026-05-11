fn main() {
    let manifest_dir = std::path::PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set by Cargo"),
    );
    let runtime_resource_dir = manifest_dir.join("../.runtime/crawclaw");
    std::fs::create_dir_all(runtime_resource_dir)
        .expect("failed to create Tauri desktop runtime resource directory");
    tauri_build::build()
}
