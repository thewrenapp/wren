fn main() {
    tauri_build::build();

    // Provide stub implementations for newer pdfium API functions that are
    // referenced by pdfium-render v0.8.37's static bindings but don't exist
    // in the older static libpdfium.a (v6694) bundled with ferrules.
    // These stubs are never called at runtime — ferrules only uses the stable
    // pdfium API subset. They're only needed because Tauri's cdylib link
    // requires all symbols to resolve.
    println!("cargo:rerun-if-changed=pdfium_stubs.c");
    cc::Build::new()
        .file("pdfium_stubs.c")
        .compile("pdfium_stubs");
}
