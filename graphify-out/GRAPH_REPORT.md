# Graph Report - AI-InvestmentDecisionSupport-main  (2026-10-02)

## Corpus Check
- 268 files · ~171,345 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 13 file(s) not represented in the graph (top: .css 5, (none) 4, .example 1)

## Summary
- 3026 nodes · 6202 edges · 153 communities (106 shown, 47 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 189 edges (avg confidence: 0.9)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Backend Test Harness and Fixtures
- API App Bootstrap and Auth
- Technical Analysis Service
- Price Action Analysis
- Shared UI Component Library
- App Shell and News View
- Stock Detail and Charts
- Portfolio Service and Cache
- Mock Data and Universe Providers
- Sidebar Navigation Primitives
- Risk Metrics Engine
- Frontend Dependency Manifest
- Database Bootstrap and Backfill
- Report Generation and PDF
- Frontend Tests and Volume Panel
- AI Advisor Chat View
- Utility and Overlay Primitives
- Portfolio View and Data Hooks
- Foreign Flow Analysis
- API Client and Portfolio Hooks
- Market Data Service
- Lint Config and Accordion Primitive
- Dashboard and Risk Views
- Volume Accumulation Analysis
- Build Scripts and Collapsible
- Broksum Web Scraper
- Quote Freshness and Batch Types
- Settings and Env Template Tests
- Broker Summary Service
- Yahoo Market Data Provider
- Header and Exchange Rates
- AI Signal Endpoint
- Celery Beat Schedule Tests
- Dialog Button and Pagination UI
- Broker Signal Inference Models
- Trade Plan Construction
- Feature Drift Detection
- Advisor Streaming Endpoint
- Symbol Universe Endpoint
- Equity Curve Live Tests
- Database Pool and Holdings
- IDX Session Bars Provider
- Advisor Widget and Metric Tiles
- Settings View and App Context
- Daily Update and Heartbeat
- Alerts Service
- Command Palette and Dialog
- Markets View and Accumulation Map
- Backend Test Fixtures
- Close Price Reconciliation
- API Config and Live Market Hook
- News Service
- Portfolio Ownership Resolution
- Advisor Session History
- Advisor Live Context Assembly
- Market Provider Circuit Breaker
- TypeScript Compiler Config
- CI Workflow and Dependency Manifest
- Docker Compose Stack
- Training Gates and Signal Training
- Migration Runner and SaaS Transformation
- IDX Provider Session Close
- Model Serving Path Tests
- Toggle Badge and Alert UI
- Menubar Primitive
- Advisor Tool Execution
- Daily Bar Validation
- Point in Time Splits
- Portfolio Optimizer Models
- Model Bundle Loading
- Market WebSocket Tests
- Dropdown Menu Primitive
- Broker Feature Engineering
- Live Risk Path Tests
- Carousel Primitive
- Form and Label Primitives
- Market Data Provider Contract
- Market Feed Ingestor
- Point in Time Feature Builder
- Sentiment Model Training
- Sentiment Inference and Disclosures
- Signal Inference and Target Price
- Broksum Refresh Worker
- Settings Tabs and Risk Metrics Spec
- Tick Aggregator Stream
- Feature Engineering Engine
- Universe Selection Logic
- Phase 10 Endpoint Tests
- Alerts View and Hook
- Historical VaR and CVaR
- Probability Tier Bands
- Technical Note Formatting
- Fake Redis Test Double
- Portfolio Fallback Path Tests
- Frontend CI and App Shell
- Risk Alert Rule Tests
- SaaS Subscriptions and Auth Tables
- Select Primitive
- Drawer Primitive
- Signal Model Training
- Admin Portal and Account Tabs
- Navigation Menu Primitive
- Recharts Chart Container
- Owner Design Direction
- Provider Registry and Reconciliation
- Walk Forward Evaluation
- IDX Row Parsing Tests
- Broker Summary Panel
- WebSocket Connection Manager
- Quote Value Object
- Fake Pool Test Double
- IDX Row Rejection Rules
- Kupiec Backtest Sign Tests
- Event Loop Pool Tests
- No Look Ahead Tests
- Booster Model Compatibility
- Signal Service Mock Tests
- Reports View and Hook
- Real Table Reference Tests
- OHLCV Endpoint Validation
- Daily Update Shell Script
- Portfolio Endpoint Tests
- API Rate Limiting
- Signal Payload Normalisation
- Holdings Module Tests
- Portfolio Identity Regression Tests
- Broksum Endpoint Tests
- Risk Endpoint Tests
- Login Authentication Tests
- Technicals Endpoint Tests
- Cross Sectional Ranking Tests
- Foreign Flow Scaling Tests
- Peer Dependency Metadata
- Prettier Formatting Config
- WebSocket Stats Endpoint
- Training Gate Constant Tests
- License and Anti Scraping Terms
- Backend Start Script
- Beat Start Script
- Worker Start Script

## God Nodes (most connected - your core abstractions)
1. `cn()` - 223 edges
2. `get_settings()` - 105 edges
3. `react` - 82 edges
4. `lucide-react` - 42 edges
5. `apiFetch()` - 36 edges
6. `build_point_in_time_features()` - 30 edges
7. `PriceActionAnalyzer` - 28 edges
8. `YahooProvider` - 27 edges
9. `AppInner()` - 27 edges
10. `redis_get_json()` - 26 edges

## Surprising Connections (you probably didn't know these)
- `AIDSS — AI Investment Decision Support System` --semantically_similar_to--> `OJK Non-Advisory Disclaimer`  [INFERRED] [semantically similar]
  README.md → docs/legal-and-consent.md
- `Signals Are Probability Scores, Not Instructions` --semantically_similar_to--> `Probability Score (0-100) Output Semantics`  [INFERRED] [semantically similar]
  README.md → docs/legal-and-consent.md
- `Not-Investment-Advice Framing` --semantically_similar_to--> `OJK Non-Advisory Disclaimer`  [INFERRED] [semantically similar]
  README.md → docs/legal-and-consent.md
- `Optimiser Fallback Chain (HRP to inverse-vol, MVO to HRP)` --semantically_similar_to--> `Real-Path Default with Labelled Seed Degradation`  [INFERRED] [semantically similar]
  backend/requirements.txt → README.md
- `Tab 3 — Appearance and Display Preferences` --semantically_similar_to--> `Light Default with Working Dark Toggle`  [INFERRED] [semantically similar]
  docs/settings-module-spec.md → DESIGN.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **AIDSS CI Verification Loop** — _github_workflows_ci_ci_pipeline, _github_workflows_ci_backend_job, _github_workflows_ci_frontend_job, _github_workflows_ci_env_template_job, _github_workflows_ci_hermetic_mock_env, backend_requirements_test_locked_test_env [EXTRACTED 1.00]
- **SaaS Checkout to Subscription Activation Flow** — docs_saas_subscription_platform_one_step_checkout, docs_saas_subscription_platform_midtrans_webhook_sha512, docs_saas_subscription_platform_manual_transfer_approval_flow, docs_saas_subscription_platform_dedicated_admin_portal, docs_saas_subscription_platform_users_table, docs_saas_subscription_platform_subscriptions_table, docs_saas_subscription_platform_transactions_table [EXTRACTED 1.00]
- **Subscription Enforcement and Scheduled Automation** — docs_saas_subscription_platform_require_active_subscription, docs_saas_subscription_platform_jwt_subscription_claims, docs_saas_subscription_platform_redis_subscription_status_cache, docs_saas_subscription_platform_celery_beat_subscription_schedule, docs_saas_subscription_platform_subscription_worker, docs_saas_subscription_platform_notification_logs_table [INFERRED 0.85]

## Communities (153 total, 47 thin omitted)

### Community 0 - "Backend Test Harness and Fixtures"
Cohesion: 0.05
Nodes (10): _compute_live_signals(), _get_inference_engine(), _load_cross_section(), _load_symbol_names(), ModelUnavailable, kupiec_test(), _build_current_features(), check_drift() (+2 more)

### Community 1 - "API App Bootstrap and Auth"
Cohesion: 0.05
Nodes (22): create_access_token(), get_current_user(), TokenPayload, verify_token(), get_settings(), get_redis_pool(), create_app(), lifespan() (+14 more)

### Community 2 - "Technical Analysis Service"
Cohesion: 0.07
Nodes (28): AccumulationBadge, AccumulationBatchResponse, AccumulationHistoryPoint, AccumulationHistoryResponse, AccumulationInfo, CandlestickPattern, EntrySignal, OHLCVCandle (+20 more)

### Community 3 - "Price Action Analysis"
Cohesion: 0.06
Nodes (11): _cluster_levels(), _count_consecutive_direction(), _empty_features(), PriceActionAnalyzer, _bars(), _series(), _series_with_slow_fills(), TestClusterLevels (+3 more)

### Community 4 - "Shared UI Component Library"
Cohesion: 0.06
Nodes (45): input-otp, @radix-ui/react-avatar, @radix-ui/react-context-menu, @radix-ui/react-tabs, Avatar(), AvatarFallback(), AvatarImage(), BreadcrumbEllipsis() (+37 more)

### Community 5 - "App Shell and News View"
Cohesion: 0.06
Nodes (43): next-themes, react-dom, sonner, AIAdvisorView, AlertsView, App(), AppInner(), DashboardView (+35 more)

### Community 6 - "Stock Detail and Charts"
Cohesion: 0.08
Nodes (45): lightweight-charts, mergeLiveBar(), wibDateString(), CandlestickChart(), CandlestickChartProps, createZonePrimitive(), cssVar(), readTheme() (+37 more)

### Community 7 - "Portfolio Service and Cache"
Cohesion: 0.08
Nodes (24): get_redis(), redis_get_json(), redis_hget_all(), redis_hset(), redis_set_json(), _warn_cache_unavailable(), AllocationWeight, EquityCurveResponse (+16 more)

### Community 8 - "Mock Data and Universe Providers"
Cohesion: 0.06
Nodes (15): generate_all_mock_broksum(), generate_mock_broksum(), generate_mock_broksum_history(), _lot_scale(), _canonical_series(), generate_mock_ohlcv(), _round_to_tick(), _tick_size() (+7 more)

### Community 9 - "Sidebar Navigation Primitives"
Cohesion: 0.06
Nodes (45): @radix-ui/react-separator, @radix-ui/react-tooltip, Input(), Separator(), Sheet(), SheetContent(), SheetDescription(), SheetFooter() (+37 more)

### Community 10 - "Risk Metrics Engine"
Cohesion: 0.08
Nodes (17): RiskMetrics, RiskMetricsResponse, SectorExposureItem, StressTest, _compute_live_risk(), get_risk_metrics(), _load_returns_history(), _load_seed() (+9 more)

### Community 11 - "Frontend Dependency Manifest"
Cohesion: 0.04
Nodes (50): dependencies, class-variance-authority, clsx, cmdk, date-fns, embla-carousel-react, input-otp, lightweight-charts (+42 more)

### Community 12 - "Database Bootstrap and Backfill"
Cohesion: 0.06
Nodes (21): _applied(), _checksum(), _discover(), _dsn(), main(), migrate(), status(), main() (+13 more)

### Community 13 - "Report Generation and PDF"
Cohesion: 0.09
Nodes (17): ReportGenerateResponse, ReportListResponse, ReportMeta, ReportType, reports_download_endpoint(), reports_generate_endpoint(), reports_list_endpoint(), generate_pdf() (+9 more)

### Community 14 - "Frontend Tests and Volume Panel"
Cohesion: 0.06
Nodes (22): @tailwindcss/vite, @testing-library/jest-dom, @testing-library/react, vite, @vitejs/plugin-react, vitest, IndicatorCell(), PHASE_CFG (+14 more)

### Community 15 - "AI Advisor Chat View"
Cohesion: 0.08
Nodes (38): AdvisorMessage, AdvisorChat(), AdvisorChatProps, SUGGESTIONS, AIAdvisorView(), CandlestickChart, clearDisclaimerAccepted(), DisclaimerModal() (+30 more)

### Community 16 - "Utility and Overlay Primitives"
Cohesion: 0.06
Nodes (25): clsx, @radix-ui/react-checkbox, @radix-ui/react-hover-card, @radix-ui/react-popover, @radix-ui/react-progress, @radix-ui/react-radio-group, @radix-ui/react-scroll-area, @radix-ui/react-slider (+17 more)

### Community 17 - "Portfolio View and Data Hooks"
Cohesion: 0.10
Nodes (33): lucide-react, AllocationPanel(), AllocationPanelProps, ActionBtn(), PortfolioView(), Props, fieldStyle(), ModalBtn() (+25 more)

### Community 18 - "Foreign Flow Analysis"
Cohesion: 0.10
Nodes (15): analyse_foreign_flow(), _clip(), _consistency_days(), _describe(), _empty(), _fmt_lot(), foreign_flow_history(), _foreign_series() (+7 more)

### Community 19 - "API Client and Portfolio Hooks"
Cohesion: 0.07
Nodes (36): zod, apiFetch(), handleAuthFailure(), allocationWeightSchema, optimisationMetricsSchema, parseOrThrow(), portfolioResponseSchema, riskMetricsSchema (+28 more)

### Community 20 - "Market Data Service"
Cohesion: 0.09
Nodes (19): _intraday_tick_task(), _market_poller_task(), _next_interval(), FxRate, IhsgSnapshot, IntradayPoint, MarketSnapshot, MarketTickMessage (+11 more)

### Community 21 - "Lint Config and Accordion Primitive"
Cohesion: 0.06
Nodes (33): name, vite, peerDependencies, react, react-dom, pnpm, overrides, private (+25 more)

### Community 22 - "Dashboard and Risk Views"
Cohesion: 0.10
Nodes (31): ALERT_COLORS, ALERT_ICONS, DashboardView(), RadarPanelProps, RiskGauge(), RiskRadarPanel, RiskView(), StressPanelProps (+23 more)

### Community 23 - "Volume Accumulation Analysis"
Cohesion: 0.12
Nodes (16): accumulation_history(), _adl(), analyse_accumulation(), _clip(), _cmf(), _describe(), _mfi(), _obv() (+8 more)

### Community 24 - "Build Scripts and Collapsible"
Cohesion: 0.05
Nodes (33): devDependencies, eslint, @eslint/js, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals, jsdom, prettier (+25 more)

### Community 25 - "Broksum Web Scraper"
Cohesion: 0.07
Nodes (6): BroksumScraper, _scrape_with_limit(), ProxyPool, _collect_rows(), _scrape_all(), _session_timestamp()

### Community 26 - "Quote Freshness and Batch Types"
Cohesion: 0.09
Nodes (4): QuoteBatch, _quote(), TestQuoteBatch, TestQuoteFreshness

### Community 27 - "Settings and Env Template Tests"
Cohesion: 0.08
Nodes (5): Settings, _template_keys(), TestMockFlagsDocumentedTruthfully, TestTemplateAgreesWithDefaults, TestTemplateCoverage

### Community 28 - "Broker Summary Service"
Cohesion: 0.12
Nodes (12): BrokerActivity, BrokerRow, BrokerSummaryDay, BrokerSummaryHistoryResponse, BrokerSummaryResponse, broker_summary_endpoint(), broker_summary_history_endpoint(), _free_snapshot() (+4 more)

### Community 29 - "Yahoo Market Data Provider"
Cohesion: 0.11
Nodes (7): MarketDataError, _as_float(), _as_int(), probe(), YahooProvider, _do(), TestQuoteParsing

### Community 30 - "Header and Exchange Rates"
Cohesion: 0.10
Nodes (24): Props, DataFreshnessBadge(), DataFreshnessBadgeProps, formatAge(), dropdownStyle, getWibTime(), Header(), HeaderProps (+16 more)

### Community 31 - "AI Signal Endpoint"
Cohesion: 0.11
Nodes (12): AISignal, ModelMetrics, ShapFactor, SignalsResponse, TradePlan, TrendInfo, signal_for_symbol_endpoint(), signals_endpoint() (+4 more)

### Community 32 - "Celery Beat Schedule Tests"
Cohesion: 0.10
Nodes (6): _hours(), _schedule(), TestEndOfDayTasks, TestIntradayTasks, TestRegisteredTasks, TestScheduleTimezone

### Community 33 - "Dialog Button and Pagination UI"
Cohesion: 0.10
Nodes (21): @radix-ui/react-alert-dialog, @radix-ui/react-slot, react-day-picker, AlertDialogAction(), AlertDialogCancel(), AlertDialogContent(), AlertDialogDescription(), AlertDialogFooter() (+13 more)

### Community 34 - "Broker Signal Inference Models"
Cohesion: 0.10
Nodes (5): BrokerSummarySnapshot, GapInfo, SRLevel, _aggregate_shap(), SignalInference

### Community 35 - "Trade Plan Construction"
Cohesion: 0.15
Nodes (6): _compute_trade_plan(), _resistance(), _support(), TestDegenerateInputs, TestEntryAndRiskReward, TestStopLossBounds

### Community 36 - "Feature Drift Detection"
Cohesion: 0.11
Nodes (7): check_feature_drift(), compute_psi(), _build_feature_baseline(), TestCheckDriftTask, TestCheckFeatureDrift, TestComputePSI, TestFeatureBaseline

### Community 37 - "Advisor Streaming Endpoint"
Cohesion: 0.12
Nodes (8): ChatRequest, ChatResponse, StreamChunk, advisor_chat(), _sse_generator(), stream_advisor_response(), _make_async_iter(), TestLLMRequest

### Community 38 - "Symbol Universe Endpoint"
Cohesion: 0.16
Nodes (9): SectorCount, SectorListResponse, SymbolInfo, SymbolListResponse, list_symbols_endpoint(), sectors_endpoint(), list_sectors(), list_symbols() (+1 more)

### Community 39 - "Equity Curve Live Tests"
Cohesion: 0.10
Nodes (5): _index_bars(), TestEquityCurve, load(), TestTimezoneAlignment, _wide_frame()

### Community 40 - "Database Pool and Holdings"
Cohesion: 0.11
Nodes (9): close_pool(), _dsn(), get_pool(), _terminate_quietly(), _get_valid_symbols(), _default_portfolio_for(), _owns(), test_close_pool_is_a_noop_when_uninitialised() (+1 more)

### Community 41 - "IDX Session Bars Provider"
Cohesion: 0.13
Nodes (5): _as_float(), _as_int(), IdxProvider, _do(), probe()

### Community 42 - "Advisor Widget and Metric Tiles"
Cohesion: 0.15
Nodes (20): react-markdown, remark-gfm, MD_COMPONENTS, AdvisorWidget(), Allocation(), Frame(), MetricTiles(), PIE_COLORS (+12 more)

### Community 43 - "Settings View and App Context"
Cohesion: 0.13
Nodes (20): CurrencyOption(), Divider(), LangOption(), NotifKey, RateItem(), readNotifPrefs(), Section(), SettingRow() (+12 more)

### Community 44 - "Daily Update and Heartbeat"
Cohesion: 0.13
Nodes (13): get_heartbeat(), record_run(), health(), _invalidate_caches(), main(), _finalise(), _record_heartbeat(), _refresh_ohlcv() (+5 more)

### Community 45 - "Alerts Service"
Cohesion: 0.14
Nodes (8): AlertItem, AlertsResponse, _foreign_flow_alerts(), get_alerts(), _market_alerts(), _rel_time(), _risk_news_alerts(), _signal_alerts()

### Community 46 - "Command Palette and Dialog"
Cohesion: 0.14
Nodes (18): cmdk, @radix-ui/react-dialog, Command(), CommandDialog(), CommandGroup(), CommandInput(), CommandItem(), CommandList() (+10 more)

### Community 47 - "Markets View and Accumulation Map"
Cohesion: 0.13
Nodes (19): recharts, AccumulationBadge(), AccumulationBadgeProps, CFG, MarketRow, MarketsView(), MiniSparkline, parseMktCap() (+11 more)

### Community 48 - "Backend Test Fixtures"
Cohesion: 0.12
Nodes (7): app(), async_client(), client(), _close_db_pool(), _drop_module_pool(), live_settings(), mock_redis()

### Community 49 - "Close Price Reconciliation"
Cohesion: 0.12
Nodes (4): Discrepancy, reconcile_closes(), ReconciliationReport, TestReconciliation

### Community 50 - "API Config and Live Market Hook"
Cohesion: 0.17
Nodes (18): API_BASE, AUTH_EXPIRED_EVENT, authHeaders(), authToken(), onAuthExpired(), signalAuthExpired(), WS_BASE, buildInitialStocks() (+10 more)

### Community 51 - "News Service"
Cohesion: 0.17
Nodes (7): NewsItem, NewsResponse, news_endpoint(), _detail_url(), _fetch_announcements(), get_news(), _parse_announcement()

### Community 52 - "Portfolio Ownership Resolution"
Cohesion: 0.11
Nodes (4): alerts_endpoint(), risk_portfolio_endpoint(), resolve_portfolio_id(), TestPortfolioOwnership

### Community 53 - "Advisor Session History"
Cohesion: 0.16
Nodes (5): ChatMessage, _load_session_history(), _save_session_history(), _chunk(), TestSessionPersistence

### Community 54 - "Advisor Live Context Assembly"
Cohesion: 0.12
Nodes (4): _build_context_block(), _load_live_context(), _signals_age_minutes(), TestLiveContext

### Community 55 - "Market Provider Circuit Breaker"
Cohesion: 0.14
Nodes (5): _CircuitBreaker, _from_jk(), _to_jk(), TestCircuitBreaker, TestSymbolMapping

### Community 56 - "TypeScript Compiler Config"
Cohesion: 0.10
Nodes (19): compilerOptions, allowSyntheticDefaultImports, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, jsx, lib, module (+11 more)

### Community 57 - "CI Workflow and Dependency Manifest"
Cohesion: 0.13
Nodes (8): Backend Job — pytest with Coverage Gate, GitHub Actions CI Workflow, Backend Job — .env.example Covers Every Setting, Full Production Dependency Manifest, Locked Lean Test/CI Dependency Set, Portfolio Optimisation (Black-Litterman + HRP), CI Runs Backend and Frontend Suites on Every Push/PR, MarketDataProvider Abstraction

### Community 58 - "Docker Compose Stack"
Cohesion: 0.18
Nodes (15): Compose Service — FastAPI api, Compose Service — Celery beat scheduler, Compose Service — db-init Schema Bootstrap, Compose Service — Celery Flower Monitoring, AIDSS Local Docker Compose Stack, Compose Service — MLflow Tracking (Phase 3+), Compose Service — Redis Cache, Compose Service — Redpanda (Kafka-compatible, Phase 2) (+7 more)

### Community 59 - "Training Gates and Signal Training"
Cohesion: 0.19
Nodes (3): check_gates(), _report(), TestGates

### Community 60 - "Migration Runner and SaaS Transformation"
Cohesion: 0.12
Nodes (12): Migration 0002 — Unique Index on signals(symbol, generated_at) (GAP-09), Migration 0003 — instruments Universe Dimension Table (GAP-10), Migration 0004 — portfolios with owner_sub (SEC-01), db/migrate.py Migration Runner, db/schema.sql Authoritative As-Built Schema, Duplicate-Billing Refund Exception, Hybrid Midtrans QRIS/VA and Manual Bank Transfer, Subscription Pricing Tiers (IDR 15,000 / 150,000) (+4 more)

### Community 61 - "IDX Provider Session Close"
Cohesion: 0.13
Nodes (4): _session_close_utc(), provider(), TestQuoteChangeDirection, TestSessionSemantics

### Community 62 - "Model Serving Path Tests"
Cohesion: 0.11
Nodes (3): TestCrossSectionRequirement, TestNanHandling, TestShapMapping

### Community 63 - "Toggle Badge and Alert UI"
Cohesion: 0.15
Nodes (14): class-variance-authority, @radix-ui/react-toggle, @radix-ui/react-toggle-group, Alert(), AlertDescription(), AlertTitle(), alertVariants, Badge() (+6 more)

### Community 64 - "Menubar Primitive"
Cohesion: 0.12
Nodes (13): @radix-ui/react-menubar, Menubar(), MenubarCheckboxItem(), MenubarContent(), MenubarItem(), MenubarLabel(), MenubarPortal(), MenubarRadioItem() (+5 more)

### Community 66 - "Daily Bar Validation"
Cohesion: 0.16
Nodes (3): DailyBar, TestForeignNet, TestBarValidation

### Community 67 - "Point in Time Splits"
Cohesion: 0.18
Nodes (4): walk_forward_splits(), _bars(), TestSchema, TestWalkForward

### Community 68 - "Portfolio Optimizer Models"
Cohesion: 0.21
Nodes (7): _black_litterman(), _build_bl_views(), _capm_equilibrium_returns(), _compute_portfolio_metrics(), _hrp_weights(), _mean_variance_weights(), _to_lots()

### Community 71 - "Dropdown Menu Primitive"
Cohesion: 0.12
Nodes (10): @radix-ui/react-dropdown-menu, DropdownMenuCheckboxItem(), DropdownMenuContent(), DropdownMenuItem(), DropdownMenuLabel(), DropdownMenuRadioItem(), DropdownMenuSeparator(), DropdownMenuShortcut() (+2 more)

### Community 72 - "Broker Feature Engineering"
Cohesion: 0.20
Nodes (6): compute_accumulation_score(), compute_broksum_features(), _compute_consistency(), _compute_herfindahl(), _empty_result(), _sigmoid_score()

### Community 73 - "Live Risk Path Tests"
Cohesion: 0.13
Nodes (3): _df_stub(), _fake_provider(), TestLiveRisk

### Community 74 - "Carousel Primitive"
Cohesion: 0.17
Nodes (15): embla-carousel-react, Button(), Carousel(), CarouselApi, CarouselContent(), CarouselContext, CarouselContextProps, CarouselItem() (+7 more)

### Community 75 - "Form and Label Primitives"
Cohesion: 0.18
Nodes (13): @radix-ui/react-label, react-hook-form, FormControl(), FormDescription(), FormFieldContext, FormFieldContextValue, FormItem(), FormItemContext (+5 more)

### Community 77 - "Market Feed Ingestor"
Cohesion: 0.17
Nodes (4): _delivery_report(), FeedIngestor, _make_kafka_producer(), _normalise_yahoo_tick()

### Community 78 - "Point in Time Feature Builder"
Cohesion: 0.26
Nodes (8): build_point_in_time_features(), _foreign_flow(), _label(), _liquidity(), _rolling_returns(), _rsi(), _trend_and_position(), _volatility()

### Community 79 - "Sentiment Model Training"
Cohesion: 0.16
Nodes (3): compute_metrics(), SentimentDataset, train()

### Community 80 - "Sentiment Inference and Disclosures"
Cohesion: 0.14
Nodes (4): doc_hash(), SentimentInference, fetch_bei_disclosures(), score_documents()

### Community 81 - "Signal Inference and Target Price"
Cohesion: 0.17
Nodes (3): _parse_model_version(), _target_price(), TestModelVersionParsing

### Community 82 - "Broksum Refresh Worker"
Cohesion: 0.19
Nodes (6): _cache_snapshots(), _load_history(), refresh_accumulation(), _warm(), refresh_broksum(), _write_rows()

### Community 83 - "Settings Tabs and Risk Metrics Spec"
Cohesion: 0.16
Nodes (13): Migration 0001 — signals.probability_tier (GAP-01), Design Dials — ENERGY 1 / RHYTHM 2 / MOTION 1, Dual-Gate Consent System, OJK Non-Advisory Disclaimer, Probability Score (0-100) Output Semantics, Tab 5 — About and Support, localStorage Toggle Persistence with Saved Indicator, Tab 4 — In-App Notification Toggles (+5 more)

### Community 85 - "Feature Engineering Engine"
Cohesion: 0.30
Nodes (8): add_bollinger(), add_foreign_flow(), add_macd(), add_macro_features(), add_momentum(), add_pe_percentile(), add_rsi(), build_features()

### Community 87 - "Phase 10 Endpoint Tests"
Cohesion: 0.14
Nodes (3): no_redis(), TestAccumulationBatchEndpoint, TestSignalsContractUnchanged

### Community 88 - "Alerts View and Hook"
Cohesion: 0.19
Nodes (11): AlertItem, AlertsViewProps, ORDER, SEVERITY, TYPE_ICON, ALERTS_DATA, persist(), readKeySet() (+3 more)

### Community 90 - "Probability Tier Bands"
Cohesion: 0.22
Nodes (3): _uprob_to_tier(), TestProbabilityTierBands, first_uprob_reaching()

### Community 91 - "Technical Note Formatting"
Cohesion: 0.22
Nodes (3): _build_technical_note(), _format_idr(), TestTechnicalNoteForeignFlow

### Community 92 - "Fake Redis Test Double"
Cohesion: 0.17
Nodes (3): _FakeRedis, test_health_distinguishes_inert_drift_from_stable_drift(), probe()

### Community 93 - "Portfolio Fallback Path Tests"
Cohesion: 0.19
Nodes (3): TestPortfolioLivePathFallback, _empty_matrix(), TestPortfolioService

### Community 94 - "Frontend CI and App Shell"
Cohesion: 0.18
Nodes (11): Frontend Job — Typecheck, Lint, Test, Build, shadcn/ui Components (MIT), Radix Tabs Underline Navigation, Settings Component Split (settings/ subcomponents), Tab-Based Settings Redesign, Settings as User Account Center, React App Shell (index.html), Client Entry Module /src/main.tsx (+3 more)

### Community 96 - "SaaS Subscriptions and Auth Tables"
Cohesion: 0.24
Nodes (11): JWT Claims sub / role / sub_status, Midtrans Webhook SHA-512 Signature Validation, One-Step Checkout Flow, Redis Subscription Status Cache (TTL 5 minutes), RequireActiveSubscription Backend Dependency, SaaS REST API Surface (Public, Subscriber, Admin), subscriptions Table (Plan Lifecycle), transactions Table (Billing Records) (+3 more)

### Community 97 - "Select Primitive"
Cohesion: 0.20
Nodes (8): @radix-ui/react-select, SelectContent(), SelectItem(), SelectLabel(), SelectScrollDownButton(), SelectScrollUpButton(), SelectSeparator(), SelectTrigger()

### Community 98 - "Drawer Primitive"
Cohesion: 0.20
Nodes (8): vaul, DrawerContent(), DrawerDescription(), DrawerFooter(), DrawerHeader(), DrawerOverlay(), DrawerPortal(), DrawerTitle()

### Community 100 - "Admin Portal and Account Tabs"
Cohesion: 0.18
Nodes (8): Argon2id/bcrypt Password Hashing, Right to Erasure / Right to be Forgotten, Privacy Policy under UU PDP No. 27/2022, AdminGuard Role Enforcement, Dedicated Admin Portal (/admin), Manual Transfer Proof and Admin Approval Flow, Per-User Salt Argon2id/bcrypt Password Security, Tab 1 — Profile and Account

### Community 101 - "Navigation Menu Primitive"
Cohesion: 0.22
Nodes (10): @radix-ui/react-navigation-menu, NavigationMenu(), NavigationMenuContent(), NavigationMenuIndicator(), NavigationMenuItem(), NavigationMenuLink(), NavigationMenuList(), NavigationMenuTrigger() (+2 more)

### Community 102 - "Recharts Chart Container"
Cohesion: 0.27
Nodes (10): ChartConfig, ChartContainer(), ChartContext, ChartContextProps, ChartLegendContent(), ChartStyle(), ChartTooltipContent(), getPayloadConfigFromPayload() (+2 more)

### Community 103 - "Owner Design Direction"
Cohesion: 0.24
Nodes (4): Unsplash Photographs, DESIGN.md Owner Design Direction, Self-Directed Investor Audience, Tab 3 — Appearance and Display Preferences

### Community 104 - "Provider Registry and Reconciliation"
Cohesion: 0.20
Nodes (3): get_history_provider(), reconcile_latest_session(), TestProviderContract

### Community 105 - "Walk Forward Evaluation"
Cohesion: 0.31
Nodes (4): evaluate_walk_forward(), load_training_bars(), main(), train()

### Community 107 - "Broker Summary Panel"
Cohesion: 0.38
Nodes (9): BrokerList(), BrokerSummaryPanel(), BrokerSummaryPanelProps, formatLots(), HistoryStrip(), PHASE_CFG, phaseLabel(), VolumeMetrics() (+1 more)

### Community 112 - "Kupiec Backtest Sign Tests"
Cohesion: 0.22
Nodes (3): _price_frame(), TestKupiecSign, _worker_frame()

### Community 117 - "Reports View and Hook"
Cohesion: 0.31
Nodes (7): ReportsView(), typeColors, OFFLINE, ReportMeta, ReportsResult, ReportType, useReports()

### Community 118 - "Real Table Reference Tests"
Cohesion: 0.25
Nodes (4): _cte_names(), _db_sql_statements(), _schema_tables(), TestSqlReferencesRealTables

### Community 120 - "Daily Update Shell Script"
Cohesion: 0.29
Nodes (6): DATABASE_URL, PYTHONPATH, REDIS_URL, daily_update.sh script, USE_MOCK_MARKET, USE_MOCK_SIGNALS

### Community 123 - "Signal Payload Normalisation"
Cohesion: 0.33
Nodes (3): _get_signals(), _normalise_signals(), _pick_signal_highlights()

### Community 132 - "Peer Dependency Metadata"
Cohesion: 0.40
Nodes (5): peerDependenciesMeta, react, react-dom, optional, optional

### Community 133 - "Prettier Formatting Config"
Cohesion: 0.40
Nodes (4): printWidth, semi, singleQuote, trailingComma

### Community 136 - "License and Anti Scraping Terms"
Cohesion: 0.67
Nodes (3): Anti-Scraping and Reverse-Engineering Prohibition, Prohibition of Signal Reselling, Non-Transferable Single-User License

## Ambiguous Edges - Review These
- `Frontend Job — Typecheck, Lint, Test, Build` → `pnpm Workspace Root Declaration`  [AMBIGUOUS]
  .github/workflows/ci.yml · relation: references
- `Unsplash Photographs` → `DESIGN.md Owner Design Direction`  [AMBIGUOUS]
  ATTRIBUTIONS.md · relation: conceptually_related_to
- `Restrained and Analytical Personality` → `Tab 5 — About and Support`  [AMBIGUOUS]
  docs/settings-module-spec.md · relation: conceptually_related_to

## Knowledge Gaps
- **276 isolated node(s):** `semi`, `singleQuote`, `trailingComma`, `printWidth`, `daily_update.sh script` (+271 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 1195 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **47 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Frontend Job — Typecheck, Lint, Test, Build` and `pnpm Workspace Root Declaration`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `Unsplash Photographs` and `DESIGN.md Owner Design Direction`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Restrained and Analytical Personality` and `Tab 5 — About and Support`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `get_settings()` connect `API App Bootstrap and Auth` to `Backend Test Harness and Fixtures`, `Technical Analysis Service`, `Portfolio Service and Cache`, `Risk Metrics Engine`, `Database Bootstrap and Backfill`, `Market Data Service`, `Broksum Web Scraper`, `Settings and Env Template Tests`, `Broker Summary Service`, `Yahoo Market Data Provider`, `AI Signal Endpoint`, `Broker Signal Inference Models`, `Advisor Streaming Endpoint`, `Database Pool and Holdings`, `Daily Update and Heartbeat`, `Backend Test Fixtures`, `News Service`, `Advisor Session History`, `Model Bundle Loading`, `Market Feed Ingestor`, `Sentiment Model Training`, `Sentiment Inference and Disclosures`, `Signal Inference and Target Price`, `Broksum Refresh Worker`, `Signal Model Training`, `Walk Forward Evaluation`, `API Rate Limiting`?**
  _High betweenness centrality (0.082) - this node is a cross-community bridge._
- **Why does `react` connect `Utility and Overlay Primitives` to `Shared UI Component Library`, `App Shell and News View`, `Stock Detail and Charts`, `Sidebar Navigation Primitives`, `AI Advisor Chat View`, `Portfolio View and Data Hooks`, `API Client and Portfolio Hooks`, `Lint Config and Accordion Primitive`, `Dashboard and Risk Views`, `Header and Exchange Rates`, `Dialog Button and Pagination UI`, `Advisor Widget and Metric Tiles`, `Settings View and App Context`, `Command Palette and Dialog`, `Markets View and Accumulation Map`, `API Config and Live Market Hook`, `Toggle Badge and Alert UI`, `Menubar Primitive`, `Dropdown Menu Primitive`, `Carousel Primitive`, `Form and Label Primitives`, `Alerts View and Hook`, `Select Primitive`, `Drawer Primitive`, `Navigation Menu Primitive`, `Recharts Chart Container`, `Reports View and Hook`?**
  _High betweenness centrality (0.040) - this node is a cross-community bridge._
- **Why does `QuoteBatch` connect `Quote Freshness and Batch Types` to `IDX Session Bars Provider`, `Market Data Provider Contract`, `IDX Provider Session Close`, `Market Provider Circuit Breaker`, `Yahoo Market Data Provider`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **What connects `semi`, `singleQuote`, `trailingComma` to the rest of the system?**
  _276 weakly-connected nodes found - possible documentation gaps or missing edges._