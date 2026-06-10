#![recursion_limit = "512"]

mod config_contract;
mod desktop_packaging;
mod ghsa_patch;
mod github_labels;
mod node_tool_runner;
mod node_tooling;
mod npm_release;
mod package_build;
mod package_release;
mod plugin_dependency_plan;
mod plugin_version_sync;
mod provider_contract;
mod repo_checks;
mod repo_guardrails;

pub use config_contract::{
    base_config_schema_payload, base_config_schema_payload_json, config_doc_baseline_json,
    config_doc_baseline_jsonl, write_config_doc_baseline_artifacts, ConfigDocBaselineWriteResult,
};
pub use desktop_packaging::{
    check_desktop_runtime_release_inputs, resolve_desktop_runtime_stage_paths,
    stage_desktop_tauri_runtime, DesktopRuntimeCheckOptions, DesktopRuntimeStagePaths,
};
pub use ghsa_patch::{parse_ghsa_id, run_ghsa_patch};
pub use github_labels::{
    collect_configured_label_names, parse_github_repo_remote, resolve_label_metadata,
    run_github_labels_sync, LabelMetadata,
};
pub use node_tool_runner::{
    build_oxlint_invocation, build_tsgo_invocation, build_typecheck_invocation, run_oxlint,
    run_tsgo, run_typecheck,
};
pub use node_tooling::{
    assert_node_version, current_env as node_tooling_current_env, npm_program, pnpm_program,
    resolve_node_modules_bin, run_node_bin, run_npm, run_npm_output, run_npm_prefix, run_pnpm,
    run_pnpm_dlx_with_node_major, run_pnpm_script, NodeVersionPolicy, ToolInvocation,
    ROOT_NODE_POLICY,
};
pub use npm_release::{
    collect_plugin_release_plan, collect_publishable_plugin_packages, compare_release_versions,
    format_npm_publish_plan_lines, parse_plugin_release_args, parse_release_version,
    read_package_metadata, resolve_npm_dist_tag_mirror_auth, resolve_plugin_npm_publish_plan,
    resolve_root_npm_publish_plan, run_root_npm_release_check, select_publishable_plugin_packages,
    should_require_npm_dist_tag_mirror_auth, verify_published_npm_install, NpmDistTagMirrorAuth,
    NpmPublishPlan, ParsedPluginReleaseArgs, ParsedReleaseVersion, PluginReleasePlan,
    PluginReleasePlanItem, PluginReleaseSelectionMode, PublishablePluginPackage, ReleaseChannel,
    RootNpmReleaseCheckResult,
};
pub use package_build::{
    build_automation_release_upload_plan, list_automation_release_assets,
    list_bundled_plugin_pack_artifacts, list_static_package_asset_outputs,
    stage_native_binary_artifacts, stage_package_postbuild, write_package_build_metadata,
    AutomationReleaseAsset, AutomationReleaseUploadPlan, StaticPackageAsset,
};
pub use package_release::{
    collect_package_release_check_errors, format_package_release_check_errors, run_package_prepack,
    PackagePrepackOutcome, PackageReleaseCheckErrors,
};
pub use plugin_dependency_plan::{
    relative_to_repo as plugin_dependency_plan_relative_to_repo,
    write_plugin_dependency_plan_artifacts, PluginDependencyPlanWriteResult,
};
pub use plugin_version_sync::{sync_plugin_versions, PluginVersionSyncSummary};
pub use provider_contract::{
    render_bundled_capability_metadata_module, render_bundled_provider_auth_env_var_module,
    render_provider_runtime_constants_module, write_bundled_capability_metadata_module,
    write_bundled_provider_auth_env_var_module, write_provider_runtime_constants_module,
    GeneratedModuleWriteResult,
};
pub use repo_checks::{collect_ts_loc_offenders, render_docs_list, TsLocOffender};
pub use repo_guardrails::{
    run_docs_anchor_audit, run_docs_i18n_glossary, run_docs_i18n_source_hash, run_docs_link_audit,
    run_no_conflict_markers, run_no_extension_src_imports, run_no_register_http_handler,
    run_plugin_extension_import_boundary, run_runtime_module_boundaries,
    run_web_fetch_provider_boundaries, run_web_search_provider_boundaries,
    run_webhook_auth_body_order, CheckReport,
};
