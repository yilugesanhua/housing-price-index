# 历史数据修订申请

本目录只保存经过人工复核并准备进入受保护发布流程的机器可读申请。文件名使用 `revision_id.json`，已发布申请不得覆盖或删除。

下列字段是D05和D07批准后的目标契约；当前实现与验证状态见 [实施状态登记](../../docs/IMPLEMENTATION_STATUS.md)。对应编号通过前不得据此运行生产历史修订工作流，也不得把文档格式更新视为代码已经兼容。

申请至少包含规范定义的版本链、撤销来源、批准信息和逐字段 `changes`。发布类别固定使用 `release_type=historical_correction`；修订成因使用 `reason_type=official_revision|parser_error|transform_error|mapping_error`，不得再用 `revision_type` 混合表示两种含义。每条修改必须使用 `统计月份|城市ID|住宅类型|面积分类` 作为 `record_key`，同时记录字段名、旧值、新值、国家统计局 URL 和原始表格定位。

申请必须分开登记 `latest_month_source_batch_ids` 和 `revision_source_batch_ids`。前者覆盖当前最新月份四类官方表，后者覆盖全部被修订历史记录的来源批次；私有审计收集到的批次集合必须与后者精确一致。

同一个 `revision_id` 必须同时登记被替代的 `revoked_dataset_versions` 和 `revoked_source_dataset_versions`，两类记录分别精确绑定候选数据包和候选源版本。幂等重跑只有在双重撤销、替代目标、来源链、账本和发布身份全部匹配时才能继续补监测或审计；缺任一侧都属于 `conflict`。旧格式申请只有在可独立证明被替代数据包及源版本身份时才允许进入受审计迁移，证据不足时停止，不得自动推断或只补一类撤销。

执行前先修复解析器或数据规则并全量重建；不得为了匹配申请而手改生成 JSON。受保护工作流会从 `baseline_commit_sha` 读取旧发布数据，并要求实际业务字段差异与批准清单逐项完全一致。
