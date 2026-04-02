pub mod commands;
pub mod connector;
pub mod db;
pub mod filename;
pub mod graph;
pub mod jobs;
pub mod llm;
pub mod pdf;
pub mod rag;
pub mod search;
pub mod state;
pub mod tray;

use state::AppState;
use tauri::menu::{AboutMetadataBuilder, CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager, RunEvent};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "wren=debug,tauri=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            tracing::info!("Setting up Wren application");

            // Initialize app state
            let app_state = tauri::async_runtime::block_on(async {
                AppState::new(app.handle()).await
            })?;

            app.manage(app_state);

            // Build native menu with standard macOS menus

            // App menu (Wren)
            let about_metadata = AboutMetadataBuilder::new()
                .name(Some("Wren"))
                .version(Some("0.1.0"))
                .build();

            let settings_item = MenuItemBuilder::with_id("settings", "Settings...")
                .accelerator("CmdOrCtrl+,")
                .build(app)?;

            let app_menu = SubmenuBuilder::new(app, "Wren")
                .about(Some(about_metadata))
                .separator()
                .item(&settings_item)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;

            // File menu
            let file_menu = SubmenuBuilder::new(app, "File")
                .close_window()
                .build()?;

            // Edit menu
            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            // View menu with Library Layout submenu
            let layout_normal = CheckMenuItemBuilder::with_id("layout_normal", "Normal")
                .checked(true)
                .build(app)?;
            let layout_stacked = CheckMenuItemBuilder::with_id("layout_stacked", "Stacked")
                .checked(false)
                .build(app)?;

            let library_layout_submenu = SubmenuBuilder::new(app, "Library Layout")
                .item(&layout_normal)
                .item(&layout_stacked)
                .build()?;

            let view_menu = SubmenuBuilder::new(app, "View")
                .fullscreen()
                .separator()
                .item(&library_layout_submenu)
                .build()?;

            // Window menu
            let window_menu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .maximize()
                .separator()
                .close_window()
                .build()?;

            // Help menu
            let help_menu = SubmenuBuilder::new(app, "Help")
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&app_menu)
                .item(&file_menu)
                .item(&edit_menu)
                .item(&view_menu)
                .item(&window_menu)
                .item(&help_menu)
                .build()?;

            app.set_menu(menu)?;

            // Handle menu events
            let layout_normal_clone = layout_normal.clone();
            let layout_stacked_clone = layout_stacked.clone();

            app.on_menu_event(move |app_handle, event| {
                match event.id().as_ref() {
                    "settings" => {
                        let _ = app_handle.emit("menu:open-settings", ());
                    }
                    "layout_normal" => {
                        let _ = layout_normal_clone.set_checked(true);
                        let _ = layout_stacked_clone.set_checked(false);
                        let _ = app_handle.emit("menu:set-library-layout", "normal");
                    }
                    "layout_stacked" => {
                        let _ = layout_normal_clone.set_checked(false);
                        let _ = layout_stacked_clone.set_checked(true);
                        let _ = app_handle.emit("menu:set-library-layout", "stacked");
                    }
                    _ => {}
                }
            });

            // Setup system tray (non-fatal)
            if let Err(e) = tray::setup_tray(app) {
                tracing::warn!("Failed to setup system tray: {e}");
            }

            tracing::info!("Wren setup complete");
            Ok(())
        })
        .on_window_event(|window, event| {
            // Hide main window to tray instead of quitting
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                    #[cfg(target_os = "macos")]
                    {
                        let _ = window.app_handle().set_dock_visibility(false);
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            // Entries
            commands::entries::get_entries,
            commands::entries::get_entries_paged,
            commands::entries::get_entry_counts,
            commands::entries::get_entry,
            commands::entries::create_entry,
            commands::entries::update_entry,
            commands::entries::delete_entry,
            commands::entries::get_entry_attachments,
            commands::entries::get_entries_attachments,
            commands::entries::get_attachment,
            commands::entries::create_attachment,
            commands::entries::delete_attachment,
            commands::entries::add_entry_tag,
            commands::entries::remove_entry_tag,
            commands::entries::add_entry_to_collection,
            commands::entries::remove_entry_from_collection,
            commands::entries::get_item_types,
            commands::entries::get_attachment_types,
            commands::entries::show_entry_in_finder,
            commands::entries::show_attachment_in_finder,
            commands::entries::show_markdown_in_finder,
            commands::entries::show_entries_in_finder,
            commands::entries::open_file_with_default_app,
            commands::entries::add_pdf_attachment,
            commands::entries::add_file_attachment,
            commands::entries::duplicate_entry,
            commands::entries::repair_entry_attachments,
            // Schema introspection
            commands::schema::get_all_item_types,
            commands::schema::get_all_creator_types,
            commands::schema::get_all_fields,
            commands::schema::get_item_type_info,
            commands::schema::get_item_type_fields,
            commands::schema::get_item_type_creator_types,
            // Trash
            commands::entries::get_trashed_entries,
            commands::entries::get_trash_count,
            commands::entries::restore_entry,
            commands::entries::permanent_delete_entry,
            commands::entries::empty_trash,
            // Collections
            commands::collections::get_collections,
            commands::collections::create_collection,
            commands::collections::update_collection,
            commands::collections::delete_collection,
            commands::collections::add_item_to_collection,
            commands::collections::remove_item_from_collection,
            commands::collections::merge_collections,
            commands::collections::delete_collection_with_entries,
            commands::collections::bulk_update_collection_color,
            // Tags
            commands::tags::get_tags,
            commands::tags::create_tag,
            commands::tags::delete_tag,
            commands::tags::merge_tags,
            commands::tags::bulk_update_tag_color,
            commands::tags::add_tag_to_item,
            commands::tags::remove_tag_from_item,
            commands::tags::add_tag_to_entries,
            commands::tags::update_tag,
            // Settings
            commands::settings::get_settings,
            commands::settings::update_setting,
            commands::settings::get_library_path,
            // Import
            commands::import::import_pdf,
            commands::import::import_pdfs,
            commands::import::import_folder,
            commands::import::import_bibtex,
            commands::import::import_csl_json,
            commands::import::import_biblatex_with_files,
            commands::import::preview_biblatex_import,
            // Annotations
            commands::annotations::get_annotations,
            commands::annotations::create_annotation,
            commands::annotations::update_annotation,
            commands::annotations::delete_annotation,
            // PDF annotation sync
            commands::annotations::save_annotation_to_pdf,
            commands::annotations::remove_annotation_from_pdf,
            commands::annotations::import_annotations_from_pdf,
            // Export
            commands::export::export_to_csl_json,
            commands::export::export_to_bibtex,
            commands::export::export_all_to_csl_json,
            commands::export::export_all_to_bibtex,
            commands::export::export_to_biblatex_with_files,
            commands::export::export_all_to_biblatex_with_files,
            // Duplicates
            commands::duplicates::find_duplicates,
            commands::duplicates::get_duplicate_count,
            commands::duplicates::merge_entries,
            commands::duplicates::discard_duplicates,
            // Saved Searches (Smart Filters)
            commands::saved_searches::get_saved_searches,
            commands::saved_searches::get_saved_search,
            commands::saved_searches::create_saved_search,
            commands::saved_searches::update_saved_search,
            commands::saved_searches::delete_saved_search,
            commands::saved_searches::reorder_saved_searches,
            // Full-text Search
            commands::search::full_text_search,
            commands::search::reindex_entry,
            commands::search::reindex_attachment,
            commands::search::reindex_library,
            commands::search::get_markdown_content,
            commands::search::save_markdown_content,
            // Inline Tables
            commands::inline_tables::create_inline_table,
            commands::inline_tables::get_inline_table,
            commands::inline_tables::get_inline_tables,
            commands::inline_tables::update_inline_table,
            commands::inline_tables::add_inline_table_row,
            commands::inline_tables::update_inline_table_row,
            commands::inline_tables::delete_inline_table_row,
            commands::inline_tables::reorder_inline_table_rows,
            commands::inline_tables::delete_inline_table,
            commands::inline_tables::get_inline_table_as_markdown,
            commands::inline_tables::get_inline_table_refs,
            commands::inline_tables::get_inline_table_info,
            // Entry Links / Backlinks
            commands::entry_links::get_entry_backlinks,
            commands::entry_links::sync_note_entry_links,
            commands::entry_links::create_entry_link,
            commands::entry_links::delete_entry_link,
            // Jobs
            jobs::commands::enqueue_job,
            jobs::commands::get_jobs,
            jobs::commands::get_job,
            jobs::commands::cancel_job,
            jobs::commands::retry_job,
            jobs::commands::clear_finished_jobs,
            // LLM Document Parsing
            commands::llm::parse_document,
            commands::llm::parse_entries,
            commands::llm::get_parsed_content,
            commands::llm::get_entry_parsed_content,
            commands::llm::update_parsed_content,
            commands::llm::delete_parsed_content,
            commands::llm::list_llm_models,
            commands::llm::validate_llm_config,
            // AI Metadata
            commands::metadata_ai::extract_metadata_with_ai,
            // RAG
            commands::rag::rag_search,
            commands::rag::rag_status,
            commands::rag::rag_index_entry,
            commands::rag::rag_index_all,
            commands::rag::rag_get_summaries,
            commands::rag::rag_get_collection_summaries,
            commands::rag::rag_build_collection_raptor,
            commands::rag::rag_rebuild,
            // Connector
            commands::connector::get_connector_status,
            commands::connector::start_connector_server,
            commands::connector::stop_connector_server,
            commands::connector::regenerate_connector_token,
        ])
        .build(tauri::generate_context!())
        .expect("error building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                let state = app_handle.state::<AppState>();
                tauri::async_runtime::block_on(async {
                    // Graceful shutdown: stop connector server
                    if let Some(server) = state.connector_server.write().await.take() {
                        server.stop().await;
                    }
                    // Cancel running jobs and let restartable ones be recovered on next startup
                    state.job_queue.shutdown().await;
                });
            }
        });
}
