fn main() {
    tauri_build::build();

    println!("cargo:rerun-if-changed=icons/tray-icon@2x.png");
}
