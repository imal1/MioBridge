# Graph Report - .  (2026-07-12)

## Corpus Check
- 333 files · ~266,155 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3228 nodes · 7227 edges · 191 communities (140 shown, 51 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 299 edges (avg confidence: 0.65)
- Token cost: 18,000 input · 9,000 output

## Community Hubs (Navigation)
- flowctl Engine +1
- flowctl Engine +1
- flowctl Engine +1
- Agent Runtime
- flowctl Engine +1
- Frontend App
- Frontend App +1
- flowctl Engine
- Frontend App
- Frontend App
- Flow Tasks +18
- Frontend App
- Codex Memory +11
- Frontend App
- Frontend Tsconfig +15
- UI Design Mockups +27
- Frontend App
- Core Package
- flowctl Engine
- Frontend App
- Frontend App
- CLI Package
- Frontend App
- Frontend Package +10
- Core Package
- Core Package
- Frontend App
- Frontend Package +8
- Dev Dependencies +13
- Frontend App
- Frontend App
- Agent TS Config +6
- Build Scripts
- CLI Package
- Core Package
- flowctl Engine
- Frontend App
- CLI Package
- CLI Package
- CLI Package
- Core Package
- UI Design Mockups
- flowctl Engine
- Core Package
- Core Package
- E2E Scripts
- flowctl Engine
- Frontend App
- Core Package
- flowctl Engine +1
- flowctl Engine
- Frontend App
- Package Engines +18
- flowctl Engine
- flowctl Engine
- CLI Package
- flowctl Engine +1
- UI Design Mockups
- Shell Scripts
- UI Design Mockups
- flowctl Engine
- Frontend Components
- TypeScript Config
- Dependencies +8
- Clash References +15
- Agent Package +1
- UI Design Mockups
- flowctl Engine
- flowctl Engine
- flowctl Engine
- flowctl Engine
- Frontend App
- Frontend App
- CLI Package
- UI Design Mockups
- UI Design Mockups
- CLI Package
- TypeScript Paths +9
- UI Design Mockups
- UI Design Mockups
- flowctl Engine
- Frontend Package
- Core Package
- Core Package
- Server Scripts
- UI Design Mockups
- UI Design Mockups
- UI Design Mockups
- flowctl Engine
- flowctl Engine
- flowctl Engine
- Frontend App
- Core Package
- Shell Scripts
- Manage Scripts
- flowctl Engine +1
- UI Design Mockups
- UI Design Mockups
- flowctl Engine
- Frontend App
- Frontend App
- Core Package +1
- CLI Package
- Core Package
- Shell Scripts
- flowctl Engine
- Frontend App
- Core Package
- Core Package
- Install Scripts
- UI Design Mockups
- UI Design Mockups
- flowctl Engine +1
- Frontend App
- Frontend App
- Tsconfig Tsc +6
- UI Design Mockups
- flowctl Engine
- Frontend App
- Shell Scripts
- Frontend App
- Frontend App
- Frontend App
- Ensure Scripts
- Shell Scripts
- flowctl Engine
- flowctl Engine
- Frontend App
- Frontend App
- CLI Package
- Shell Scripts
- UI Design Mockups
- Frontend App
- E2E Scripts
- Install Scripts
- Claude Config
- flowctl Engine
- flowctl Engine
- flowctl Engine
- Next.js Config
- Frontend App
- Frontend App
- Frontend App
- Frontend App
- Core Package
- TypeScript Config +2
- E2E Scripts
- Packaging Scripts
- Uninstall Scripts
- Flow Usage +1
- Frontend Package +2
- Frontend App
- MCP Config +2
- Core Package
- Class Variance +1
- flowctl Engine
- flowctl Engine
- flowctl Engine
- flowctl Engine
- flowctl Engine
- Next.js Config
- Frontend Package +1
- Frontend Package
- Frontend Package +1
- Frontend Package +1
- Frontend Package +1
- Frontend Package
- Frontend Package +1
- Frontend Package +1
- Frontend Package +1
- Frontend Package +1
- Frontend Package +1
- Frontend Package +1
- Frontend Package +1
- Frontend Package +1
- Frontend Package +1
- Frontend Package +1
- Frontend App
- Frontend App
- Manage +1
- ES2020 References +1
- Build Scripts
- Packaging Scripts
- Prepare Scripts
- TypeScript Config +1
- Caveman Rules

## God Nodes (most connected - your core abstractions)
1. `main()` - 126 edges
2. `json_output()` - 123 edges
3. `error_exit()` - 122 edges
4. `get_flow_dir()` - 86 edges
5. `ensure_flow_exists()` - 82 edges
6. `NodeManager` - 56 edges
7. `now_iso()` - 48 edges
8. `get_repo_root()` - 40 edges
9. `ApiService` - 40 edges
10. `NodeConfig` - 40 edges

## Surprising Connections (you probably didn't know these)
- `Copilot Instructions` --semantically_similar_to--> `OpenCode AGENTS rules`  [INFERRED] [semantically similar]
  .github/copilot-instructions.md → .opencode/AGENTS.md
- `Copilot Instructions` --semantically_similar_to--> `Windsurf Caveman Rule`  [INFERRED] [semantically similar]
  .github/copilot-instructions.md → .windsurf/rules/caveman.md
- `OpenCode AGENTS rules` --semantically_similar_to--> `Windsurf Caveman Rule`  [INFERRED] [semantically similar]
  .opencode/AGENTS.md → .windsurf/rules/caveman.md
- `startAgentStub()` --indirect_call--> `error()`  [INFERRED]
  frontend/src/server/services/__tests__/nodeManager.test.ts → packages/core/test/contracts.test.ts
- `MioBridge Release Command` --conceptually_related_to--> `release.yml Workflow`  [AMBIGUOUS]
  .claude/commands/miobridge:release.md → .Codex/memory/ci-cd-pipeline.md

## Import Cycles
- 2-file cycle: `packages/core/src/index.ts -> packages/core/src/mioBridgeCore.ts -> packages/core/src/index.ts`
- 2-file cycle: `packages/core/src/index.ts -> packages/core/src/status/statusService.ts -> packages/core/src/index.ts`
- 2-file cycle: `packages/core/src/index.ts -> packages/core/src/state/stateStore.ts -> packages/core/src/index.ts`
- 2-file cycle: `packages/core/src/index.ts -> packages/core/src/kernels/ports.ts -> packages/core/src/index.ts`
- 3-file cycle: `packages/core/src/index.ts -> packages/core/src/mioBridgeCore.ts -> packages/core/src/state/stateStore.ts -> packages/core/src/index.ts`
- 3-file cycle: `packages/core/src/index.ts -> packages/core/src/mioBridgeCore.ts -> packages/core/src/status/statusService.ts -> packages/core/src/index.ts`
- 3-file cycle: `packages/core/src/index.ts -> packages/core/src/nodes/nodeRepository.ts -> packages/core/src/state/stateStore.ts -> packages/core/src/index.ts`
- 3-file cycle: `packages/core/src/index.ts -> packages/core/src/kernels/jsonOutboundAdapters.ts -> packages/core/src/kernels/ports.ts -> packages/core/src/index.ts`
- 3-file cycle: `packages/core/src/index.ts -> packages/core/src/kernels/mihomoAdapter.ts -> packages/core/src/kernels/ports.ts -> packages/core/src/index.ts`
- 3-file cycle: `packages/core/src/index.ts -> packages/core/src/kernels/singBoxAdapter.ts -> packages/core/src/kernels/ports.ts -> packages/core/src/index.ts`
- 4-file cycle: `packages/core/src/index.ts -> packages/core/src/nodes/nodeAggregationService.ts -> packages/core/src/nodes/nodeRepository.ts -> packages/core/src/state/stateStore.ts -> packages/core/src/index.ts`

## Hyperedges (group relationships)
- **Project Memory Corpus** — _codex_memory_memory_index, _codex_memory_bug_fixes_doc, _codex_memory_ci_cd_pipeline_doc, _codex_memory_project_architecture_doc, _codex_memory_deployment_flow_doc, _codex_memory_config_patterns_doc, _codex_memory_coding_conventions_doc [EXTRACTED 1.00]
- **Graph-Powered Development Skills** — _claude_skills_debug_issue_skill_workflow, _claude_skills_explore_codebase_skill_workflow, _claude_skills_refactor_safely_skill_workflow, _claude_skills_review_changes_skill_workflow [INFERRED 0.85]
- **CLI Release Pipeline** — _codex_memory_project_architecture_cli_dashboard_provider, _codex_memory_ci_cd_pipeline_ci_yml, _codex_memory_ci_cd_pipeline_cli_systemd_e2e_yml, _codex_memory_ci_cd_pipeline_release_yml [INFERRED 0.85]
- **MioBridgeCore composition root participants** — flow_specs_fn_1_extract_headless_core_to_packagescore_miobridgecore, flow_specs_fn_1_extract_headless_core_to_packagescore_runtimepaths, flow_tasks_fn_1_extract_headless_core_to_packagescore_2_statestore, flow_tasks_fn_1_extract_headless_core_to_packagescore_5_buildclashsubscriptionresult, flow_tasks_fn_1_extract_headless_core_to_packagescore_3_kernel_adapters, flow_tasks_fn_1_extract_headless_core_to_packagescore_4_agentclient, flow_tasks_fn_1_extract_headless_core_to_packagescore_4_noderepository, flow_tasks_fn_1_extract_headless_core_to_packagescore_4_nodeaggregationservice [INFERRED 0.85]
- **fn-1 headless core extraction task sequence** — flow_tasks_fn_1_extract_headless_core_to_packagescore_1, flow_tasks_fn_1_extract_headless_core_to_packagescore_2, flow_tasks_fn_1_extract_headless_core_to_packagescore_3, flow_tasks_fn_1_extract_headless_core_to_packagescore_4, flow_tasks_fn_1_extract_headless_core_to_packagescore_5, flow_tasks_fn_1_extract_headless_core_to_packagescore_6, flow_tasks_fn_1_extract_headless_core_to_packagescore_7 [EXTRACTED 1.00]
- **Dashboard provider lifecycle (manifest, foreground, systemd)** — flow_specs_fn_2_miobridge_cli_with_guided_linux_install_dashboard_provider_manifest, flow_tasks_fn_2_miobridge_cli_with_guided_linux_install_4_dashboardforegroundservice, flow_tasks_fn_2_miobridge_cli_with_guided_linux_install_5_dashboardsystemdservice, flow_tasks_fn_2_miobridge_cli_with_guided_linux_install_4_package_dashboard_provider_sh [EXTRACTED 1.00]
- **PRD Functional Redesign Requirements R1-R7** — doc_design_product_redesign_prd_readiness_console, doc_design_product_redesign_prd_artifact_center, doc_design_product_redesign_prd_generation_pipeline, doc_design_product_redesign_prd_node_lifecycle, doc_design_product_redesign_prd_deployment_runbook, doc_design_product_redesign_prd_diagnostics, doc_design_product_redesign_prd_permission_boundaries [INFERRED 0.85]
- **Caveman Response Style Rule Files** — github_copilot_instructions, opencode_agents, windsurf_rules_caveman [INFERRED 0.95]
- **MioBridge CI/CD Workflow Set** — github_workflows_ci, github_workflows_cli_systemd_e2e, github_workflows_release [INFERRED 0.85]
- **API Endpoints Organized by Capability and Permission Scope** — doc_design_images_api-docs_endpointsection, doc_design_images_api-docs_grouppublicartifacts, doc_design_images_api-docs_groupcontrolops, doc_design_images_api-docs_groupdiagreads, doc_design_images_api-docs_permsubscriptionread, doc_design_images_api-docs_permsubscriptionupdate, doc_design_images_api-docs_permnodesread [EXTRACTED 0.95]
- **Configuration Runtime Pipeline** — doc_design_images_config_sourcediscovery, doc_design_images_config_converter, doc_design_images_config_outputfiles [INFERRED 0.85]
- **Main flow 4-step onboarding sequence** — doc_design_images_dashboard_addnodes, doc_design_images_dashboard_deployagent, doc_design_images_dashboard_updatesubscription, doc_design_images_dashboard_verifyoutput [EXTRACTED 1.00]
- **Overview page layout: sidebar + status cards + main flow** — doc_design_images_dashboard_overview, doc_design_images_dashboard_sidebar, doc_design_images_dashboard_subscription_card, doc_design_images_dashboard_nextstep_card, doc_design_images_dashboard_mainflow, doc_design_images_dashboard_progress [EXTRACTED 1.00]
- **Blocking item resolution flow: detect -> next step -> diagnostics -> continue** — doc_design_images_dashboard_hk_timeout, doc_design_images_dashboard_nextstep_card, doc_design_images_dashboard_diagnostics_action, doc_design_images_dashboard_continue_blocking [INFERRED 0.85]
- **API Endpoint to Capability and Permission Matrix** — doc_design_images_day_api_docs_endpoint_clash_yaml, doc_design_images_day_api_docs_endpoint_subscription_txt, doc_design_images_day_api_docs_endpoint_api_update, doc_design_images_day_api_docs_endpoint_api_cluster_status, doc_design_images_day_api_docs_capability_public_output, doc_design_images_day_api_docs_capability_control_operation, doc_design_images_day_api_docs_capability_diagnostic_read, doc_design_images_day_api_docs_permission_subscription_read, doc_design_images_day_api_docs_permission_subscription_update, doc_design_images_day_api_docs_permission_nodes_read [EXTRACTED 1.00]
- **Config Generation Pipeline** — doc_design_images_day-config_source_discovery, doc_design_images_day-config_converter, doc_design_images_day-config_scheduled_update, doc_design_images_day-config_output_files [EXTRACTED 0.95]
- **Main Flow Linear Progression** — doc_design_images_day-dashboard_step_add_nodes, doc_design_images_day-dashboard_step_deploy_agent, doc_design_images_day-dashboard_step_update_subscription, doc_design_images_day-dashboard_step_validate_output [EXTRACTED 1.00]
- **Blocker Resolution Loop** — doc_design_images_day-dashboard_blocker_badge, doc_design_images_day-dashboard_hk_node_timeout, doc_design_images_day-dashboard_diagnostics_action, doc_design_images_day-dashboard_step_update_subscription [INFERRED 0.85]
- **Dashboard Layout Grid** — doc_design_images_day-dashboard_sidebar_navigation, doc_design_images_day-dashboard_subscription_availability_card, doc_design_images_day-dashboard_hk_node_timeout, doc_design_images_day-dashboard_main_flow, doc_design_images_day-dashboard_flow_progress_indicator [EXTRACTED 1.00]
- **Agent Install Runbook Sequence** — doc_design_images_day-deploy_ssh_check_step, doc_design_images_day-deploy_upload_agent_step, doc_design_images_day-deploy_write_config_step, doc_design_images_day-deploy_start_service_step, doc_design_images_day-deploy_health_check_step [EXTRACTED 1.00]
- **Multi-Region Node Fleet** — doc_design_images_day-deploy_new_york_node, doc_design_images_day-deploy_toronto_node, doc_design_images_day-deploy_hong_kong_node [EXTRACTED 1.00]
- **Failure-source diagnostic flow** — doc_design_images_day-logs_failuresourcepanel, doc_design_images_day-logs_subscriptionsourcetimeout, doc_design_images_day-logs_hongkongnode, doc_design_images_day-logs_degradedavailableimpact, doc_design_images_day-logs_evidencelogpanel [INFERRED 0.85]
- **Status Determines Next Action** — doc_design_images_day-nodes_status-online, doc_design_images_day-nodes_status-degraded, doc_design_images_day-nodes_node-card, doc_design_images_day-nodes_context-aware-actions [INFERRED 0.85]
- **Edge Agent Protocol Fleet** — doc_design_images_day-nodes_singapore-node, doc_design_images_day-nodes_newyork-node, doc_design_images_day-nodes_hongkong-node, doc_design_images_day-nodes_frankfurt-node, doc_design_images_day-nodes_toronto-node, doc_design_images_day-nodes_local-node [EXTRACTED 1.00]
- **Three Subscription Artifacts** — doc_design_images_day-subscription_artifactraw, doc_design_images_day-subscription_artifactsubscription, doc_design_images_day-subscription_artifactclash [EXTRACTED 1.00]
- **Five-stage Generation Pipeline** — doc_design_images_day-subscription_pipelinesource, doc_design_images_day-subscription_pipelinededup, doc_design_images_day-subscription_pipelineencoding, doc_design_images_day-subscription_pipelineconversion, doc_design_images_day-subscription_pipelineendpoint [EXTRACTED 1.00]
- **Signal Room Operational Workflow Chain (add node -> deploy -> update subscription -> verify)** — doc_design_images_day-visual-board_nodesoperate, doc_design_images_day-visual-board_deployexecute, doc_design_images_day-visual-board_subscriptionupdate, doc_design_images_day-visual-board_subscriptionread [INFERRED 0.75]
- **Agent Installation Runbook Steps** — doc_design_images_deploy_sshcheck, doc_design_images_deploy_uploadagent, doc_design_images_deploy_writeconfig, doc_design_images_deploy_startservice, doc_design_images_deploy_healthcheck [EXTRACTED 1.00]
- **Multi-Region Node Status Monitoring** — doc_design_images_deploy_newyorknode, doc_design_images_deploy_torontonode, doc_design_images_deploy_hongkongnode, doc_design_images_deploy_deploymentqueue [EXTRACTED 1.00]
- **Failure-Source -> Evidence-Log Diagnostic Flow** — doc_design_images_logs_logspage, doc_design_images_logs_failure_sources_panel, doc_design_images_logs_evidence_log_panel, doc_design_images_logs_recommended_actions_button [INFERRED 0.85]
- **Triage Triplet: Location -> Node -> Impact** — doc_design_images_logs_triage_location, doc_design_images_logs_triage_node, doc_design_images_logs_triage_impact [EXTRACTED 1.00]
- **Subscription Update Pipeline (INFO + WARN trace)** — doc_design_images_logs_log_entry_subscription_update_request, doc_design_images_logs_log_entry_pull_remote_agent_nodes, doc_design_images_logs_log_entry_hk_node_timeout, doc_design_images_logs_log_entry_raw_txt_generated, doc_design_images_logs_log_entry_skip_one_failure_source, doc_design_images_logs_log_entry_mihomo_converted, doc_design_images_logs_log_entry_clash_yaml_generated, doc_design_images_logs_log_entry_output_endpoint_available [INFERRED 0.85]
- **Signal Room operational workflow sequence** — doc_design_images_mio_garden_ui_mockup_1783061192111_addnode, doc_design_images_mio_garden_ui_mockup_1783061192111_deployagent, doc_design_images_mio_garden_ui_mockup_1783061192111_updatesubscription, doc_design_images_mio_garden_ui_mockup_1783061192111_verifyoutput [EXTRACTED 0.95]
- **MioBridge Signal Room color palette** — doc_design_images_mio_garden_ui_mockup_1783061192111_graphite, doc_design_images_mio_garden_ui_mockup_1783061192111_carbon, doc_design_images_mio_garden_ui_mockup_1783061192111_signal, doc_design_images_mio_garden_ui_mockup_1783061192111_amber [EXTRACTED 0.95]
- **Six representative node lifecycle states visualized** — doc_design_images_nodes_node_local, doc_design_images_nodes_node_singapore, doc_design_images_nodes_node_newyork, doc_design_images_nodes_node_hongkong, doc_design_images_nodes_node_frankfurt, doc_design_images_nodes_node_toronto [INFERRED 0.95]
- **Artifact Distribution Flow (raw -> base64 -> clash)** — doc_design_images_subscription_rawtxtartifact, doc_design_images_subscription_subscriptiontxtartifact, doc_design_images_subscription_clashyamlartifact, doc_design_images_subscription_deduplicationstep, doc_design_images_subscription_base64encoding, doc_design_images_subscription_mihomoconverter [INFERRED 0.85]

## Communities (191 total, 51 thin omitted)

### Community 0 - "flowctl Engine +1"
Cohesion: 0.04
Nodes (200): atomic_write(), atomic_write_json(), canonicalize_task_for_write(), casefold_handle(), clear_task_evidence(), cmd_anchor(), cmd_block(), cmd_cat() (+192 more)

### Community 1 - "flowctl Engine +1"
Cohesion: 0.02
Nodes (137): datetime, auto_enabled_passes(), build_convergence_ratchet_block(), classify_delegation_result(), _clawpatch_dir(), _clawpatch_features_dir(), cmd_codex_check(), cmd_codex_classify_result() (+129 more)

### Community 2 - "flowctl Engine +1"
Cohesion: 0.04
Nodes (118): _apply_deep_passes_to_receipt(), _apply_validator_to_receipt(), BackendSpec, build_completion_review_prompt(), build_cursor_persona_override(), build_rereview_preamble(), build_review_prompt(), build_standalone_review_prompt() (+110 more)

### Community 3 - "Agent Runtime"
Cohesion: 0.06
Nodes (58): AgentConfig, AgentKernelConfig, AgentMihomoConfig, AgentNodeConfig, DEFAULT_CONFIG_PATHS, extractYamlValue(), getDefaultConfig(), KernelType (+50 more)

### Community 4 - "flowctl Engine +1"
Cohesion: 0.04
Nodes (68): CompletedProcess, build_chat_payload(), cmd_codex_deep_pass(), cmd_codex_rollback_plan(), cmd_codex_validate(), cmd_copilot_deep_pass(), cmd_copilot_validate(), cmd_cursor_deep_pass() (+60 more)

### Community 5 - "Frontend App"
Cohesion: 0.08
Nodes (40): Dashboard(), DashboardProps, FILES, formatBytes(), formatDate(), workflow, MethodBadge(), SignalPageProps (+32 more)

### Community 6 - "Frontend App +1"
Cohesion: 0.06
Nodes (17): config, handler(), config, handler(), config, handler(), getMioBridgeBaseDir(), MihomoVersionInfo (+9 more)

### Community 7 - "flowctl Engine"
Cohesion: 0.04
Nodes (56): _banner_ack_within_renudge_window(), _check_migration_banner(), cmd_detect(), cmd_migrate_rename(), cmd_migrate_rollback(), find_dependents(), is_supported_schema(), load_json() (+48 more)

### Community 8 - "Frontend App"
Cohesion: 0.07
Nodes (15): config, MioBridgeService, execAsync, SingBoxService, testConfig, Config, ConfigUpdateRequest, HealthStatus (+7 more)

### Community 9 - "Frontend App"
Cohesion: 0.12
Nodes (9): createUnavailableKernelStatuses(), NodeManager, NodeDeployDelegate, NodeDeployResult, NodeOperationsAdapter, getStateStore(), KernelRuntimeStatus, NodeAgentInfo (+1 more)

### Community 10 - "Flow Tasks +18"
Cohesion: 0.09
Nodes (48): fn-1: Extract headless core to packages/core, Compatibility URLs /subscription.txt /clash.yaml /raw.txt /health, Composition root with injected collaborators pattern, D-01 packages/core canonical boundary decision, Migration-before golden fixtures, MioBridgeCore composition root facade, @miobridge/core headless workspace package, RuntimePaths injected path policy (+40 more)

### Community 11 - "Frontend App"
Cohesion: 0.07
Nodes (30): register(), FILE_MAP, handler(), handler(), config, handler(), getServerSideProps(), resolveApplicationRoot() (+22 more)

### Community 12 - "Codex Memory +11"
Cohesion: 0.06
Nodes (46): MioBridge Deploy Command, MioBridge Diagnostic Command, MioBridge Release Command, API and Quality Goal, Config Management Goal, Mio Garden UI, Observability Goal, Output Customization Goal (+38 more)

### Community 13 - "Frontend App"
Cohesion: 0.09
Nodes (30): ConvertModal(), AppLayout, AppLayoutProps, ICONS, MobileDrawer(), MobileHeader(), NAV_ITEMS, NavIcon (+22 more)

### Community 14 - "Frontend Tsconfig +15"
Cohesion: 0.05
Nodes (39): compilerOptions, allowJs, baseUrl, esModuleInterop, ignoreDeprecations, incremental, isolatedModules, jsx (+31 more)

### Community 15 - "UI Design Mockups +27"
Cohesion: 0.08
Nodes (39): AGENTS.md Project Rules, Botanical Garden Design Tokens, Public Compatibility URLs, Flow-Next Task Tracking, @miobridge/core Workspace Package, MioBridgeCore Headless Facade, MioBridge Changelog 1.0.0, DeployManager Service (+31 more)

### Community 16 - "Frontend App"
Cohesion: 0.10
Nodes (28): AddNodeForm(), AddNodeFormProps, CreateNode, DeployNode, DetectKernels, EMPTY_FORM, NodeFormData, KERNEL_LABELS (+20 more)

### Community 17 - "Core Package"
Cohesion: 0.09
Nodes (12): JsonOutboundAdapter, MihomoAdapterOptions, ProxyConfig, KernelFileSystem, KernelLogger, ProcessOptions, ProcessResult, ProcessRunner (+4 more)

### Community 18 - "flowctl Engine"
Cohesion: 0.06
Nodes (35): cmd_config_get(), cmd_config_set(), cmd_init(), deep_merge(), _emit_rename_deprecation(), _ensure_flow_gitignore(), get_config(), _get_config_from_file() (+27 more)

### Community 19 - "Frontend App"
Cohesion: 0.12
Nodes (25): ALL_STEPS, DeployProgressDialog(), DeployProgressDialogProps, STATUS_COLORS, STATUS_ICONS, STEP_LABELS, createDeployTarget(), DeployPersistence (+17 more)

### Community 20 - "Frontend App"
Cohesion: 0.11
Nodes (20): initialize(), handler(), handler(), handler(), targetFromSavedNode(), targetFromUnsavedSsh(), UnsavedSshPayload, handler() (+12 more)

### Community 21 - "CLI Package"
Cohesion: 0.07
Nodes (30): bin, miobridge, dependencies, @miobridge/core, devDependencies, @types/node, typescript, vitest (+22 more)

### Community 23 - "Frontend Package +10"
Cohesion: 0.07
Nodes (29): autoprefixer, devDependencies, autoprefixer, jsdom, postcss, @testing-library/jest-dom, @testing-library/react, tw-animate-css (+21 more)

### Community 24 - "Core Package"
Cohesion: 0.07
Nodes (28): default, dependencies, yaml, devDependencies, @types/node, typescript, vitest, engines (+20 more)

### Community 25 - "Core Package"
Cohesion: 0.15
Nodes (17): ArtifactServiceOptions, LocalSourceCollector, protocols, RemoteSourceCollector, UpdateResult, silentLogger, YamlServiceOptions, CoreLogger (+9 more)

### Community 27 - "Frontend Package +8"
Cohesion: 0.07
Nodes (27): clsx, dependencies, axios, clsx, fs-extra, ky, lucide-react, @radix-ui/react-dialog (+19 more)

### Community 28 - "Dev Dependencies +13"
Cohesion: 0.07
Nodes (27): concurrently, nodemon, oxlint, devDependencies, concurrently, nodemon, oxlint, ts-node (+19 more)

### Community 29 - "Frontend App"
Cohesion: 0.11
Nodes (19): ClusterOverview(), ClusterOverviewProps, getKernelDisplayStatus(), KernelDisplayStatus, kernelLabels, KernelRuntimeDetails(), KernelStatusBadge(), KernelStatusPills() (+11 more)

### Community 31 - "Agent TS Config +6"
Cohesion: 0.08
Nodes (24): compilerOptions, baseUrl, esModuleInterop, module, moduleResolution, noEmit, paths, skipLibCheck (+16 more)

### Community 32 - "Build Scripts"
Cohesion: 0.08
Nodes (25): scripts, build, clean, cli:build, cli:release, cli:test, cli:typecheck, config:validate (+17 more)

### Community 33 - "CLI Package"
Cohesion: 0.15
Nodes (17): CliCore, CliDependencies, CliOutput, daemon(), foreground(), formatBoolean(), formatStatus(), parseCommand() (+9 more)

### Community 34 - "Core Package"
Cohesion: 0.17
Nodes (7): AgentClient, NodeAggregationService, unavailable(), NodeRepository, NodeConfig, kernels, node

### Community 35 - "flowctl Engine"
Cohesion: 0.09
Nodes (24): _anchor_capture(), _anchor_sections(), cmd_glossary_add(), cmd_glossary_list(), cmd_glossary_read(), cmd_glossary_remove(), cmd_memory_list(), _glossary_load() (+16 more)

### Community 36 - "Frontend App"
Cohesion: 0.12
Nodes (17): KernelDetectionDialogProps, detections, handler(), KernelEditorState, AGENT_LOCAL_BINARY, AgentStatus, DeployProgressCallback, DeployResult (+9 more)

### Community 37 - "CLI Package"
Cohesion: 0.17
Nodes (10): CommandResult, DashboardDaemonOptions, DashboardDaemonState, DashboardSystemdService, execFileAsync, output(), quote(), renderDashboardUserUnit() (+2 more)

### Community 38 - "CLI Package"
Cohesion: 0.20
Nodes (17): detectLinuxPlatform(), LinuxArchitecture, LinuxPlatform, PINNED_ARTIFACTS, command(), createNodeSetupAdapters(), decompress(), execFileAsync (+9 more)

### Community 39 - "CLI Package"
Cohesion: 0.08
Nodes (23): compilerOptions, declaration, declarationMap, exactOptionalPropertyTypes, forceConsistentCasingInFileNames, lib, module, moduleResolution (+15 more)

### Community 40 - "Core Package"
Cohesion: 0.08
Nodes (23): compilerOptions, declaration, declarationMap, exactOptionalPropertyTypes, forceConsistentCasingInFileNames, lib, module, moduleResolution (+15 more)

### Community 41 - "UI Design Mockups"
Cohesion: 0.14
Nodes (23): Evidence Log Panel, Failure Source: File Write, Failure Source: Local Kernel, Failure Source: Mihomo Conversion, Failure Source: Remote Agent, Failure Source: Subscription Source, Failure Sources Panel, Live Tail Indicator (+15 more)

### Community 42 - "flowctl Engine"
Cohesion: 0.09
Nodes (23): cmd_memory_add(), _frontmatter_sort_key(), _memory_emit_deprecation(), _memory_entry_path(), _memory_merge_tags(), _memory_migrate_target_path(), _memory_read_body(), _memory_update_existing_entry() (+15 more)

### Community 43 - "Core Package"
Cohesion: 0.11
Nodes (5): RuntimePaths, FileStateStore, KeyedMutex, StateStore, StateStoreOptions

### Community 44 - "Core Package"
Cohesion: 0.24
Nodes (16): CORE_PACKAGE_NAME, Outbound, V2rayAdapter, XrayAdapter, KERNEL_TYPES, KernelType, AgentClientOptions, RemoteSourceCollection (+8 more)

### Community 45 - "E2E Scripts"
Cohesion: 0.14
Nodes (20): agentDir, agentPort, CdpClient, cdpPort, children, chromeProfileDir, cleanup(), clickText() (+12 more)

### Community 46 - "flowctl Engine"
Cohesion: 0.17
Nodes (22): bind_context_window(), cmd_rp_builder(), cmd_rp_ensure_workspace(), cmd_rp_pick_window(), cmd_rp_setup_review(), extract_builder_tab_from_payload(), extract_response_window_id(), extract_root_paths() (+14 more)

### Community 47 - "Frontend App"
Cohesion: 0.13
Nodes (3): FileStateStore, RedisStateStore, StateStore

### Community 48 - "Core Package"
Cohesion: 0.12
Nodes (6): ArtifactService, ClashConverter, SourceCollection, CollectedProxySource, fixturePath, roots

### Community 49 - "flowctl Engine +1"
Cohesion: 0.10
Nodes (21): Any, _export_filter_section(), _export_parse_acceptance_criteria(), _export_task_evidence_block(), extract_workspace_paths(), _migrate_describe_plan(), _prospect_extract_rejected(), Extract rejected entries from a `## Rejected` body slice.      Format mirrors `r (+13 more)

### Community 50 - "flowctl Engine"
Cohesion: 0.13
Nodes (21): _format_prospect_list_item(), _format_prospect_yaml_value(), _format_yaml_list_item(), _format_yaml_value(), _prospect_frontmatter_sort_key(), _prospect_rewrite_in_place(), _quote_yaml_scalar(), Rewrite a prospect artifact at `src` with new frontmatter + body.      Pattern: (+13 more)

### Community 51 - "Frontend App"
Cohesion: 0.12
Nodes (5): NodeManagerLike, ReleaseInfo, UpdateChecker, UpdateCheckerEvents, UpdateCheckerOptions

### Community 52 - "Package Engines +18"
Cohesion: 0.10
Nodes (20): author, bugs, url, description, engines, bun, node, homepage (+12 more)

### Community 53 - "flowctl Engine"
Cohesion: 0.11
Nodes (20): cmd_memory_list_legacy(), cmd_memory_mark_fresh(), cmd_memory_mark_stale(), cmd_memory_read(), cmd_memory_search(), _memory_resolve_categorized_entry(), _memory_score_search(), _memory_search_snippet() (+12 more)

### Community 54 - "flowctl Engine"
Cohesion: 0.11
Nodes (20): _export_extract_removed_symbols(), _export_find_glossaries_at_base(), _export_first_sentence(), _export_glossary_diff(), _export_memory_during_epic(), _export_path_is_source(), _export_removed_export_refs(), _export_resolve_memory_threshold() (+12 more)

### Community 55 - "CLI Package"
Cohesion: 0.12
Nodes (14): createKernelFileSystem(), createNodeCore(), createProcessRunner(), execFileAsync, NodeCoreComposition, NodeCoreOptions, silentLogger, createNodeForegroundAdapters() (+6 more)

### Community 56 - "flowctl Engine +1"
Cohesion: 0.11
Nodes (19): date, _export_parse_task_satisfies(), _glossary_strip_fenced_code(), parse_glossary_file(), _parse_inline_yaml(), parse_strategy_file(), _prospect_artifact_status(), _prospect_detect_corruption() (+11 more)

### Community 57 - "UI Design Mockups"
Cohesion: 0.13
Nodes (19): Context-Aware Action Display, MioBridge Node Management Dashboard, Fleet Status Summary (5 online / 1 degraded / 1 pending), Frankfurt Node (DE) - Trojan Agent, Hong Kong Node (HK) - V2Ray Agent, Local Master Node (JP) - Sing-Box, New York Node (US) - Trojan Agent, Node Card UI Pattern (+11 more)

### Community 58 - "Shell Scripts"
Cohesion: 0.13
Nodes (14): BLUE, check_dir(), check_file(), CYAN, ensure_dir(), GREEN, NC, print_status() (+6 more)

### Community 59 - "UI Design Mockups"
Cohesion: 0.12
Nodes (18): Add Node (Step 1), Amber color (#d6a94a), Carbon color (#101511), clash.yaml artifact, Deploy Agent (Step 2), deploy:execute command, Functional Spine, Graphite color (#080b09) (+10 more)

### Community 60 - "flowctl Engine"
Cohesion: 0.12
Nodes (18): _export_changed_symbols(), _export_classify_derived(), _export_derived_rules(), _export_detect_cross_module(), _export_detect_public_exports(), _export_diff_summary(), _export_files_byte_identical(), _export_path_is_security_sensitive() (+10 more)

### Community 61 - "Frontend Components"
Cohesion: 0.11
Nodes (17): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+9 more)

### Community 62 - "TypeScript Config"
Cohesion: 0.11
Nodes (18): compilerOptions, allowSyntheticDefaultImports, baseUrl, declaration, declarationMap, emitDecoratorMetadata, esModuleInterop, experimentalDecorators (+10 more)

### Community 63 - "Dependencies +8"
Cohesion: 0.12
Nodes (17): compression, cors, express, helmet, dependencies, axios, compression, cors (+9 more)

### Community 64 - "Clash References +15"
Cohesion: 0.12
Nodes (17): keywords, api, clash, clash-meta, hysteria2, mihomo, miobridge, protocol-conversion (+9 more)

### Community 65 - "Agent Package +1"
Cohesion: 0.12
Nodes (15): devDependencies, @types/bun, typescript, typescript, name, private, scripts, build (+7 more)

### Community 66 - "UI Design Mockups"
Cohesion: 0.18
Nodes (16): MioBridge API Endpoints Page (Screenshot), API Endpoints Page (API 接口), Capability Ledger, GET /api/update, GET /api/cluster/status, GET /clash.yaml, Endpoint List (接口列表), GET /subscription.txt (+8 more)

### Community 67 - "flowctl Engine"
Cohesion: 0.12
Nodes (16): _check_dead_classifier_env_vars(), cmd_memory_migrate(), _default_memory_readme(), _emit_migrate_deprecation_hint(), _first_meaningful_line(), _memory_classify_mechanical(), _memory_migrate_build_frontmatter(), _memory_resolve_legacy_type() (+8 more)

### Community 68 - "flowctl Engine"
Cohesion: 0.14
Nodes (16): check_memory_overlap(), _memory_entry_id(), _memory_iter_entries(), _memory_parse_entry_filename(), _memory_read_entry(), _memory_score_overlap(), _memory_title_tokens(), parse_memory_frontmatter() (+8 more)

### Community 69 - "flowctl Engine"
Cohesion: 0.14
Nodes (16): cmd_prospect_archive(), cmd_prospect_list(), cmd_prospect_read(), get_prospects_dir(), _prospect_extract_section(), _prospect_extract_survivors(), _prospect_iter_artifacts(), _prospect_resolve_id() (+8 more)

### Community 70 - "flowctl Engine"
Cohesion: 0.12
Nodes (16): _memory_legacy_entry_segments(), _memory_legacy_extract_date(), _memory_legacy_extract_tags(), _memory_legacy_extract_title(), _memory_legacy_strip_title_line(), _memory_parse_legacy_entries(), _memory_resolve_read_target(), Return non-empty `---`-separated segments from a legacy flat file. (+8 more)

### Community 71 - "Frontend App"
Cohesion: 0.20
Nodes (13): Progress, Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader (+5 more)

### Community 72 - "Frontend App"
Cohesion: 0.17
Nodes (9): ApiResponse, configApi, ConfigApiClient, FrontendConfig, getAppName(), getAppVersion(), getSupportedProtocols(), useConfig() (+1 more)

### Community 73 - "CLI Package"
Cohesion: 0.20
Nodes (13): assertRelativePath(), COMPATIBILITY_PATHS, contained(), DASHBOARD_PROVIDER_SCHEMA_VERSION, DashboardProviderManifest, ENVIRONMENT_NAMES, loadDashboardProvider(), object() (+5 more)

### Community 74 - "UI Design Mockups"
Cohesion: 0.18
Nodes (15): 1 Blocker Badge (1 个阻塞项), clash.yaml Output Artifact, MioBridge Dashboard Overview, Design Intent: Progressive Disclosure via Readiness Console, Open Diagnostics Action (打开诊断), Flow Progress Indicator (3/4 ready), Hong Kong Node Source Timeout (香港节点源超时), Main Flow (主流程) (+7 more)

### Community 75 - "UI Design Mockups"
Cohesion: 0.19
Nodes (15): API Interface Page (API 接口), MioBridge API Interface Documentation Page Screenshot, Control Operations (控制操作) - update / deploy, Diagnostic Read (诊断读取) - logs / status, Future Permissions (未来权限) - action scopes, Capability Ledger (按能力边界分组端点，未来映射多用户权限), Public Output (公开产物) - 3 routes, GET /api/cluster/status (+7 more)

### Community 76 - "CLI Package"
Cohesion: 0.20
Nodes (8): dashboardManifestPath(), DashboardProcess, ForegroundAdapters, ForegroundOptions, ForegroundResult, DASHBOARD_MANIFEST_NAME, LoadedDashboardProvider, renderProviderUrl()

### Community 77 - "TypeScript Paths +9"
Cohesion: 0.13
Nodes (15): *, config/*, controllers/*, routes/*, services/*, types/*, utils/*, paths (+7 more)

### Community 78 - "UI Design Mockups"
Cohesion: 0.18
Nodes (14): Main Flow Step 1: Add Nodes (添加节点) - Complete, Continue Handling Blocking Item (继续处理阻塞项) action, Main Flow Step 2: Deploy Agent (部署 Agent) - Complete, Open Diagnostics Action (打开诊断) - entry into diag skill, Hong Kong Node Source Timeout (处理香港节点源超时) - Blocking issue, Main Flow (主流程) - 4-step progress sequence, Next Step Card (下一步) - Hong Kong node source timeout, MioBridge Dashboard Overview (总览) UI Mockup (+6 more)

### Community 79 - "UI Design Mockups"
Cohesion: 0.20
Nodes (14): Deployment Page (部署), Deployment Queue (部署队列), Deployment Runbook (RUNBOOK), Health Check Step (健康验证), Hong Kong Node (香港节点), Deployment Dashboard UI Mockup, MioBridge, New York Node (纽约节点) (+6 more)

### Community 80 - "flowctl Engine"
Cohesion: 0.16
Nodes (14): _anchor_dependencies(), get_task_section(), _iter_fence_aware(), normalize_section_content(), patch_task_section(), Dependency tasks' ids/titles/statuses/done-summaries.      Recorded `depends_on`, Compile the known-title-variant grammar for a task section heading.      Matches, Yield (line, in_fence) pairs tracking fenced-code-block state.      `in_fence` i (+6 more)

### Community 81 - "Frontend Package"
Cohesion: 0.14
Nodes (13): description, name, packageManager, private, scripts, build, dev, export (+5 more)

### Community 82 - "Core Package"
Cohesion: 0.18
Nodes (9): containedPath(), createRuntimePaths(), RuntimeEnvironment, RuntimePathsOptions, vercelRuntimeBaseDir(), createStateStore(), logger, roots (+1 more)

### Community 84 - "Server Scripts"
Cohesion: 0.41
Nodes (11): cmd_apply(), die(), err(), log(), ok(), prune_releases(), rollback(), run_sudo() (+3 more)

### Community 85 - "UI Design Mockups"
Cohesion: 0.27
Nodes (12): Config Path Card (~/.config), MioBridge Configuration Page UI, Converter (mihomo), Environment Card (production, read-only), Output Files (raw.txt, subscription.txt, clash.yaml), Permission Policy (config:write), Runtime Profile Section, Scheduled Update Toggle (enabled) (+4 more)

### Community 86 - "UI Design Mockups"
Cohesion: 0.20
Nodes (12): Subscription Page Screenshot, Clash Config Artifact (clash.yaml, mihomo-converted), Raw Link Artifact (raw.txt, 324 nodes), Universal Subscription Artifact (subscription.txt, base64), mihomo (Clash core / conversion engine), Generation Pipeline (生成管线), Pipeline Stage: Conversion (转换, mihomo), Pipeline Stage: Dedup (去重, 324 nodes) (+4 more)

### Community 87 - "UI Design Mockups"
Cohesion: 0.24
Nodes (12): Artifact Center, Base64 Subscription Encoding, clash.yaml Artifact (CLASH Config), Dark-themed Dashboard Design Pattern, Deduplication Step (324 nodes), Generation Pipeline, Mihomo Converter, Public Endpoint (3 paths) (+4 more)

### Community 88 - "flowctl Engine"
Cohesion: 0.20
Nodes (12): cmd_strategy_list(), cmd_strategy_read(), cmd_strategy_status(), find_strategy_file(), Read + parse STRATEGY.md. Returns empty schema dict if file missing., Count required + populated-optional sections.      Required sections always coun, Report strategy file presence and population.      Returns JSON `{exists, husk,, Print parsed strategy. With --section, filter to one section body.      Walks si (+4 more)

### Community 89 - "flowctl Engine"
Cohesion: 0.26
Nodes (12): _dispatch_review_with_fallback(), _model_cache_invalidate(), _model_cache_key(), _model_cache_path(), _model_cache_put(), Load the resolution cache. Corrupt / missing = cold start (never raises)., Memoize a resolved model. Best-effort — a cache write never fails a review., Drop a stale cache entry (a cached model that just failed the signature). (+4 more)

### Community 90 - "flowctl Engine"
Cohesion: 0.17
Nodes (12): finding_fingerprint(), _line_bucket(), merge_deep_findings(), _normalize_path(), promote_confidence(), Lower-case + strip leading ./ for fingerprint stability., Bucket line numbers so near-duplicates collide on fingerprint., Slugify title for fingerprint: lower, strip punctuation, truncate. (+4 more)

### Community 91 - "Frontend App"
Cohesion: 0.21
Nodes (9): API_RETRY_METHODS, apiClient, ApiError, ApiResponse, ConvertResult, DetectKernelsPayload, KERNEL_DETECTION_FIELDS, LogsResult (+1 more)

### Community 94 - "Manage Scripts"
Cohesion: 0.33
Nodes (11): cmd_check(), cmd_config(), cmd_env(), cmd_init(), cmd_setup(), cmd_verify(), main(), setup_systemd_service() (+3 more)

### Community 95 - "flowctl Engine +1"
Cohesion: 0.18
Nodes (7): ABC, Abstract interface for runtime task state storage., Load runtime state for a task. Returns None if no state file., Save runtime state for a task., Context manager for exclusive task lock., List all task IDs that have runtime state files., StateStore

### Community 96 - "UI Design Mockups"
Cohesion: 0.22
Nodes (11): clash.yaml (Available Config), Color Palette (Graphite / Carbon / Signal / Amber), Control-Plane Redesign Rationale, deploy:execute (Deploy Agent), Functional Spine, nodes:operate (Add Node), Pages-stay-separate-but-shared-workflow principle, Signal Room (+3 more)

### Community 97 - "UI Design Mockups"
Cohesion: 0.29
Nodes (11): Context-Aware Next Action Principle, Node Lifecycle State System (online / degraded / pending / offline), Frankfurt Node (DE / Trojan / Online), Hong Kong Node (HK / V2Ray / Degraded), Local Node (JP / Sing-Box / Online), New York Node (US / Trojan / Pending Deployment), Singapore Node (SG / VLESS / Online), Toronto Node (CA / VLESS / Offline) (+3 more)

### Community 98 - "flowctl Engine"
Cohesion: 0.22
Nodes (6): delete_task_runtime(), _flock(), LocalFileStateStore, Delete runtime state file entirely. Used by checkpoint restore when no runtime., File-based state store with fcntl locking., Acquire exclusive lock for task operations.

### Community 99 - "Frontend App"
Cohesion: 0.20
Nodes (5): DeployPageProps, Dashboard, getServerSideProps(), HomeProps, ClusterStatus

### Community 100 - "Frontend App"
Cohesion: 0.18
Nodes (3): fileSystem, logger, processRunner

### Community 101 - "Core Package +1"
Cohesion: 0.36
Nodes (10): source(), buildClashSubscription(), buildClashSubscriptionResult(), ClashSubscriptionResult, dedupeProxySources(), fragment(), NamedSource, readSource() (+2 more)

### Community 102 - "CLI Package"
Cohesion: 0.36
Nodes (6): DEFINITIONS, DependencySetupService, safeUrl(), DependencyName, DependencyStatus, SetupOptions

### Community 104 - "Shell Scripts"
Cohesion: 0.24
Nodes (7): check_dependencies(), check_network(), check_system(), get_user_info(), has_sudo(), safe_sudo(), system.sh script

### Community 105 - "flowctl Engine"
Cohesion: 0.22
Nodes (10): cmd_triage_skip(), Build the one-shot triage prompt for fast-model judgment., Parse SKIP/REVIEW line from LLM output. Conservative on malformed., Invoke codex as the triage judge. Returns (verdict, reason, model_used).      ve, Invoke copilot as the triage judge., Trivial-diff triage pre-check.      Decides whether the diff between ``--base``, _triage_build_llm_prompt(), _triage_parse_llm_output() (+2 more)

### Community 106 - "Frontend App"
Cohesion: 0.22
Nodes (6): createStateStore(), globalState, KeyedMutex, resetStateStoreForTests(), ENV_KEYS, savedEnv

### Community 109 - "Install Scripts"
Cohesion: 0.40
Nodes (9): cleanup_old_config(), create_yaml_config(), main(), run_install_step(), run_optional_step(), install.sh script, show_completion_info(), show_help() (+1 more)

### Community 110 - "UI Design Mockups"
Cohesion: 0.31
Nodes (9): MioBridge Configuration Page, Config Source (config.yaml), Converter (mihomo), Output Files (raw.txt, subscription.txt, clash.yaml), Permissions Model (config:write), Runtime Profile, Separation of Concerns (env, gen settings, permissions), Sidebar Navigation (Overview/Subscription/Nodes/Deploy/Config/Logs) (+1 more)

### Community 111 - "UI Design Mockups"
Cohesion: 0.25
Nodes (9): MioBridge 日志 Page (day-logs UI), Degraded Available Impact (降级可用), Evidence Log Panel (real-time stream), Failure Source Panel, Hong Kong Node (香港节点), Live Tail Page (日志流), mihomo Conversion Stage, Real-time Log Stream Pattern (+1 more)

### Community 112 - "flowctl Engine +1"
Cohesion: 0.22
Nodes (9): _export_parse_boundaries(), _export_parse_open_questions(), _export_parse_spec_section(), _export_strategy_alignment(), Return the body text under a single H2 heading (stripped)., Extract bullet items from `## Boundaries` (one bullet per line)., Extract bullet items from `## Open Questions` if present., Build the strategy_alignment block.      `tracks_served` is parsed from the spec (+1 more)

### Community 113 - "Frontend App"
Cohesion: 0.28
Nodes (6): SectionHeading(), SectionHeadingProps, Button, ButtonProps, buttonVariants, FILES

### Community 114 - "Frontend App"
Cohesion: 0.39
Nodes (7): DeployArgs, formatDeployStatus(), handleDeployRestart(), handleDeployStatus(), handleDeployUpdate(), parseDeployArgs(), sampleNodes

### Community 115 - "Tsconfig Tsc +6"
Cohesion: 0.22
Nodes (8): tsconfig-paths/register, include, src/**/*, ts-node, require, tsc-alias, resolveFullPaths, verbose

### Community 116 - "UI Design Mockups"
Cohesion: 0.39
Nodes (8): Deployment Queue, Deployment Runbook, MioBridge Deployment Dashboard Page, Hong Kong Node, MioBridge App, New York Node, Resumable Step Recovery Pattern, Toronto Node

### Community 117 - "flowctl Engine"
Cohesion: 0.25
Nodes (8): append_deferred_findings(), _branch_slug(), cmd_review_walkthrough_defer(), _format_deferred_finding(), Derive a filesystem-safe slug from the current (or supplied) branch.      Same r, Render one deferred finding as markdown bullets for the sink., Append deferred findings to ``.flow/review-deferred/<slug>.md``.      Returns th, Append deferred findings to the branch-specific sink file.      Consumes a JSON-

### Community 118 - "Frontend App"
Cohesion: 0.25
Nodes (5): mockClusterData, mockClusterHealthCheck, MockEventSource, mockStatusData, mockTriggerClusterUpdate

### Community 119 - "Shell Scripts"
Cohesion: 0.43
Nodes (7): build_all(), build_backend(), build_frontend(), check_bun(), clean_build(), copy_build_files(), build.sh script

### Community 120 - "Frontend App"
Cohesion: 0.29
Nodes (6): api, cluster, detections, node, updatedCluster, updatedNode

### Community 121 - "Frontend App"
Cohesion: 0.33
Nodes (3): getTestNodeManager(), startAgentStub(), verifyHmac()

### Community 122 - "Frontend App"
Cohesion: 0.29
Nodes (5): detections, detectKernels, getNodePrivateKey, loadNodes, loggerError

### Community 123 - "Ensure Scripts"
Cohesion: 0.48
Nodes (6): githubHeaders(), main(), outputPath, repoRoot, resolveDownload(), selectAsset()

### Community 124 - "Shell Scripts"
Cohesion: 0.48
Nodes (5): download_file(), install_binaries(), install_bun(), install_mihomo(), install.sh script

### Community 125 - "flowctl Engine"
Cohesion: 0.33
Nodes (6): _classify_triage_path(), Classify a changed file into one triage bucket.      Returns one of:       - ``c, Verify a chore-classified file's diff only touches version-like fields.      A f, Run the deterministic layer of triage.      Returns ``(verdict_or_none, reason)`, _triage_chore_is_version_only(), _triage_deterministic()

### Community 126 - "flowctl Engine"
Cohesion: 0.33
Nodes (6): Validate a single repo-relative untracked path for `git clean -fd --`.      Retu, Compute the safe scoped-rollback FILE set from pre/post untracked snapshots., Human-readable rejection reason for a path `sanitize_rollback_path` drops.     M, rollback_plan(), _rollback_reject_reason(), sanitize_rollback_path()

### Community 127 - "Frontend App"
Cohesion: 0.33
Nodes (4): ChartConfig, ChartContainer, ChartContext, ChartTooltipContent

### Community 128 - "Frontend App"
Cohesion: 0.33
Nodes (4): baseBody, loadNodes, updateNodeKernels, writeNodeWithPrivateKey

### Community 129 - "CLI Package"
Cohesion: 0.33
Nodes (3): installer, packageScript, root

### Community 130 - "Shell Scripts"
Cohesion: 0.47
Nodes (4): ensure_yq(), load_config(), config.sh script, update_config()

### Community 131 - "UI Design Mockups"
Cohesion: 0.40
Nodes (5): Runbook Step: Health Verification, Runbook Step: SSH Check, Runbook Step: Start Service, Runbook Step: Upload Agent, Runbook Step: Write Configuration

### Community 133 - "E2E Scripts"
Cohesion: 0.70
Nodes (4): fail(), run_as_user(), e2e-cli-systemd.sh script, wait_for()

### Community 134 - "Install Scripts"
Cohesion: 0.60
Nodes (3): download(), install-cli.sh script, usage()

### Community 135 - "Claude Config"
Cohesion: 0.50
Nodes (4): Debug Issue Skill, Explore Codebase Skill, Refactor Safely Skill, Review Changes Skill

### Community 136 - "flowctl Engine"
Cohesion: 0.50
Nodes (4): cmd_state_path(), get_state_dir(), Show resolved state directory path., Get state directory for runtime task state.      Resolution order:     1. FLOW_S

### Community 137 - "flowctl Engine"
Cohesion: 0.50
Nodes (4): _migrate_pid_alive(), _migrate_pid_alive_windows(), Cross-platform check whether a PID still exists.      POSIX: `os.kill(pid, 0)` i, Windows-only PID liveness via OpenProcess + GetExitCodeProcess.      `os.kill(pi

### Community 138 - "flowctl Engine"
Cohesion: 0.50
Nodes (4): _prospect_artifact_filename(), _prospect_next_id(), Filename for an artifact id (artifact id == filename stem)., Return the next free artifact id for `<base_slug>-<today_iso>` family.      Firs

### Community 139 - "Next.js Config"
Cohesion: 0.50
Nodes (3): { execSync }, nextConfig, path

### Community 143 - "Frontend App"
Cohesion: 0.50
Nodes (3): *.css, *.module.css, *.module.scss

### Community 145 - "TypeScript Config +2"
Cohesion: 0.50
Nodes (4): **/*.test.ts, exclude, dist, node_modules

### Community 147 - "Packaging Scripts"
Cohesion: 1.00
Nodes (3): build_one(), need(), package-cli-release.sh script

### Community 149 - "Flow Usage +1"
Cohesion: 1.00
Nodes (3): Canonical 7-section spec template, Flow-Next usage guide and flowctl CLI reference, flowctl Flow-Next task tracking CLI

### Community 150 - "Frontend Package +2"
Cohesion: 0.67
Nodes (3): react, useChart(), react

## Ambiguous Edges - Review These
- `MioBridge Release Command` → `release.yml Workflow`  [AMBIGUOUS]
  .claude/commands/miobridge:release.md · relation: conceptually_related_to

## Knowledge Gaps
- **619 isolated node(s):** `uvx`, `name`, `version`, `private`, `type` (+614 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **51 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `MioBridge Release Command` and `release.yml Workflow`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `source()` connect `Core Package +1` to `Frontend App`, `Core Package`, `Frontend App`?**
  _High betweenness centrality (0.039) - this node is a cross-community bridge._
- **Why does `buildClashSubscriptionResult()` connect `Core Package +1` to `Core Package`, `Core Package`, `Core Package`, `Core Package`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Why does `dependencies` connect `Frontend Package +8` to `Frontend Package +2`, `Class Variance +1`, `Frontend Package +1`, `Frontend Package`, `Frontend Package +1`, `Frontend Package +1`, `Frontend Package +1`, `Frontend Package`, `Frontend Package +1`, `Frontend Package +1`, `Frontend Package +1`, `Frontend Package +1`, `Frontend Package +1`, `Frontend Package +1`, `Frontend Package +1`, `Frontend Package +1`, `Frontend Package +1`, `Frontend Package +1`, `Frontend Package`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Are the 121 inferred relationships involving `main()` (e.g. with `cmd_anchor()` and `cmd_block()`) actually correct?**
  _`main()` has 121 INFERRED edges - model-reasoned connections that need verification._
- **What connects `uvx`, `name`, `version` to the rest of the system?**
  _619 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `flowctl Engine +1` be split into smaller, more focused modules?**
  _Cohesion score 0.039308408452785576 - nodes in this community are weakly interconnected._