window.__ModuleLoader__.load({
  id: '@kamisangk/dsh-sync',
  factory(require) {
    const React = require('react');
    const { createElement: h, useEffect, useId, useRef, useState, useSyncExternalStore } = React;
    const ns = 'kamisangk-dsh-sync';

    // Direction ids are the Host contract; labels come from the locale service.
    const DIRECTIONS = [
      {id: 'upload', label: 'dir_upload'},
      {id: 'download', label: 'dir_download'},
      {id: 'both', label: 'dir_both'},
    ];
    // Which view reports the outcome of an action: configuring is a connection
    // matter, syncing is not. Status checks follow whichever view is open.
    const NOTICE_PAGE = {save: 'connection', test: 'connection', direction: 'sync', preview: 'sync', sync: 'sync', apply: 'sync', resolve: 'sync', restore: 'sync', backup_create: 'sync', backup_delete: 'sync'};
    const SCOPES = [
      {id: 'plugins', enabled: true},
      {id: 'settings', enabled: true},
      {id: 'models', enabled: true},
      {id: 'mcp', enabled: true},
      {id: 'skills', enabled: true},
    ];

    const english = {
      title: 'DSH-SYNC',
      tab_sync: 'Sync',
      tab_connection: 'Connection',
      tabs_label: 'Plugin sync views',
      dir_upload: 'Upload only', dir_download: 'Download only', dir_both: 'Two-way backup (union)',
      badge_ok: 'Synced',
      badge_failed: 'Sync failed',
      badge_pending: 'Needs attention',
      badge_idle: 'Not checked yet',
      badge_reserved: 'Not available yet',
      badge_unconfigured: 'Not configured',
      meta_plugins: '{local} plugins here · {remote} on the remote',
      meta_items: '{local} items here · {remote} on the remote',
      item_col: 'Item',
      confirm_restore_module: 'Restore {category} items from backup {id}? Current local state is backed up first.',
      last_attempt: 'Last sync {time}',
      last_attempt_failed: 'Last attempt failed: {error}',
      never_synced: 'Not synced yet',
      sync: 'Sync',
      retry: 'Retry',
      show_details: 'Show differences',
      hide_details: 'Hide differences',
      refresh: 'Refresh status',
      loading: 'Working…',
      load_failed: 'Connection settings could not be loaded.',
      load: 'Reload',
      sync_done: 'Sync finished.',
      direction_saved: 'Direction saved.',
      scope_plugins: 'Plugins',
      scope_plugins_detail: 'Installation source, exact version and enablement',
      scope_settings: 'DSH settings',
      scope_settings_detail: 'Built-in DSH preferences',
      scope_models: 'Model configuration',
      scope_models_detail: 'Providers and model routes',
      scope_mcp: 'MCP configuration',
      scope_mcp_detail: 'MCP servers and their settings',
      scope_skills: 'Skill configuration',
      scope_skills_detail: 'Skills and their configuration',
      connection: 'Connection',
      connection_summary: '● {transport} · {target}',
      connection_missing: 'No sync target configured yet.',
      transport: 'Transport',
      transport_webdav: 'WebDAV',
      transport_git: 'Git',
      webdav_address: 'Server address',
      webdav_dir: 'Folder',
      webdav_username: 'Username',
      webdav_password: 'Password',
      retention: 'Remote backups to keep',
      auto_apply: 'Install missing plugins during sync',
      git_repo: 'Repository URL',
      git_branch: 'Branch',
      git_auth: 'Authentication',
      git_auth_ssh: 'SSH key (system ssh-agent)',
      git_auth_https: 'HTTPS token',
      git_username: 'Git user name (HTTPS)',
      git_token: 'HTTPS token',
      git_author_name: 'Commit author name',
      git_author_email: 'Commit author email',
      git_repo_required: 'Save a repository URL first.',
      save: 'Save',
      test: 'Test connection',
      saved: 'Settings saved.',
      tested: 'Connection test succeeded.',
      unsaved: 'Save settings before syncing or applying a plan.',
      invalid_retention: 'Enter a whole number from 0 to 50.',
      address_required: 'Enter the server address.',
      address_invalid: 'Enter an https:// address without user name, query or fragment.',
      dir_invalid: 'The folder cannot contain ? # \\ or a . or .. segment.',
      confirm_keep_local: 'Publish this device version of “{name}” to {target}?',
      confirm_use_remote: 'Replace the local state of “{name}” with the remote version from {target}?',
      plan: 'Differences',
      plan_empty: 'The two sides match; nothing to do.',
      plan_counts: 'upload {up} · download {down} · conflict {conflict}',
      pick: 'Select change',
      name: 'Plugin',
      kind: 'Difference',
      local: 'This device',
      remote: 'Remote',
      baseline: 'Last synced',
      action: 'Decision',
      apply: 'Apply selected changes',
      selected: 'Selected',
      conflicts: 'Needs your decision',
      conflicts_note: 'Both sides changed this plugin. Choose the side to keep; the other side is left alone until it syncs again.',
      keep_local: 'Keep this device',
      use_remote: 'Use remote',
      keep_local_hint: 'Publish this device version to the remote list.',
      use_remote_hint: 'Apply the remote version here.',
      unavailable: 'Not available in this direction',
      outcomes: 'Results',
      added: 'Added',
      updated: 'Updated',
      history: 'Remote backups',
      on: 'Enabled',
      off: 'Disabled',
      install: 'Install missing plugin',
      upgrade: 'Upgrade',
      enable: 'Enable',
      disable: 'Disable',
      'local-only': 'Only on this device',
      'local-update': 'Changed on this device',
      'remote-update': 'Changed on the remote',
      'local-newer': 'This device is newer',
      'source-mismatch': 'Different install source',
      'same-version-drift': 'Same version, different commit',
      manual: 'Manual action required',
      'local-source': 'Local development plugins stay on this device.',
      unpinned: 'The source is not pinned to an exact version or commit.',
      'unsupported-source': 'This installation source is not supported.',
      'no-baseline': 'Never synced before and the two sides differ.',
      divergent: 'Both sides changed since the last sync.',
      'local-change-not-publishable': 'This local change cannot be published automatically.',
      'restart-required': 'Restart DSH to activate',
      'approval-required': 'Review build-script approval in DSH Plugin Manager.',
      overridden: 'Overridden by another setting',
      appliedStatus: 'Applied',
      installedStatus: 'Installed',
      backups: 'Backups',
      backup_manager_title: 'Backup Data Management',
      backup_manage: 'Manage Backups',
      backup_now: 'Backup Now',
      backup_created: 'Backup created.',
      backup_note: 'A local copy is saved before every sync; remote backups are uploaded on changes and keep the newest {retention}.',
      backup_filename: 'File Name',
      backup_modified: 'Modified',
      backup_size: 'Size',
      backup_actions: 'Actions',
      backup_time: 'Time',
      backup_where: 'Where',
      backup_files: 'Files',
      backup_remote: 'Remote',
      backup_local_only: 'Local only',
      backup_empty: 'No backups yet. Run a sync or create a backup first.',
      backup_remote_failed: 'Remote backups could not be read: {error}',
      backup_unavailable: 'The remote index is unavailable; local copies can still be restored.',
      backup_refresh: 'Refresh',
      backup_delete: 'Delete',
      backup_delete_selected: 'Delete Selected ({count})',
      backup_deleted: 'Backup deleted.',
      backup_select_all: 'Select all backups',
      backup_select_one: 'Select backup {name}',
      confirm_delete_backup: 'Delete backup {name}? This cannot be undone.',
      confirm_delete_selected: 'Delete {count} selected backups? This cannot be undone.',
      close: 'Close',
      restore: 'Restore',
      restored: 'Backup restored.',
      confirm_restore: 'Restore the plugins recorded in backup {id}? Plugins installed now that are not in that backup keep their current state.',
      restore_kept: 'Kept because the backup does not include it.',
      failed: 'Failed',
      cancelled: 'Cancelled',
      skipped: 'Skipped',
      resolved: 'Decision applied.',
      resolve_failed: 'The decision did not apply. Refresh the differences and try again.',
      requestFailed: 'The request failed.',
      invalidResponse: 'The Host returned an invalid response.',
      nothing: '—',
      mode_etag: 'conditional writes',
      mode_lock: 'WebDAV lock',
    };

    const chinese = {
      title: 'DSH-SYNC',
      tab_sync: '同步',
      tab_connection: '连接',
      tabs_label: '插件同步视图',
      dir_upload: '仅上传', dir_download: '仅下载', dir_both: '双向备份（并集）',
      badge_ok: '已同步',
      badge_failed: '同步失败',
      badge_pending: '需要处理',
      badge_idle: '尚未同步',
      badge_reserved: '暂未开放',
      badge_unconfigured: '未配置',
      meta_plugins: '本机 {local} 个 · 远端 {remote} 个',
      meta_items: '本机 {local} 项 · 远端 {remote} 项',
      item_col: '配置项',
      confirm_restore_module: '确定恢复备份 {id} 里的 {category} 配置吗？恢复前会自动备份当前本机状态。',
      last_attempt: '上次同步 {time}',
      last_attempt_failed: '上次失败：{error}',
      never_synced: '还没有同步过',
      sync: '同步',
      retry: '重试',
      show_details: '显示差异',
      hide_details: '收起差异',
      refresh: '刷新状态',
      loading: '处理中…',
      load_failed: '无法读取连接设置。',
      load: '重新加载',
      sync_done: '同步完成。',
      direction_saved: '方向已保存。',
      scope_plugins: '插件',
      scope_plugins_detail: '安装来源、确切版本和启用状态',
      scope_settings: 'DSH 设置',
      scope_settings_detail: 'DSH 自带偏好',
      scope_models: '模型配置',
      scope_models_detail: '模型提供方与路由',
      scope_mcp: 'MCP 配置',
      scope_mcp_detail: 'MCP 服务器与配置',
      scope_skills: 'Skill 配置',
      scope_skills_detail: '技能与相关配置',
      connection: '连接',
      connection_summary: '● {transport} · {target}',
      connection_missing: '还没有配置同步目标。',
      transport: '传输方式',
      transport_webdav: 'WebDAV',
      transport_git: 'Git',
      webdav_address: '地址',
      webdav_dir: '文件目录',
      webdav_username: '用户名',
      webdav_password: '密码',
      retention: '远端备份保留数量',
      auto_apply: '同步时安装缺失插件',
      git_repo: '仓库地址',
      git_branch: '分支',
      git_auth: '认证方式',
      git_auth_ssh: 'SSH 密钥（系统 ssh-agent）',
      git_auth_https: 'HTTPS 令牌',
      git_username: 'Git 用户名（HTTPS）',
      git_token: 'HTTPS 令牌',
      git_author_name: '提交作者名',
      git_author_email: '提交作者邮箱',
      git_repo_required: '请先保存仓库地址。',
      save: '保存',
      test: '测试连接',
      saved: '设置已保存。',
      tested: '连接测试成功。',
      unsaved: '请先保存设置，再同步或应用计划。',
      invalid_retention: '请输入 0–50 的整数。',
      address_required: '请填写地址。',
      address_invalid: '地址需为 https:// 开头的网址，且不含用户名、查询参数或锚点。',
      dir_invalid: '文件目录不能包含 ?、#、\\，也不能有 . 或 .. 路径段。',
      confirm_keep_local: '确定把「{name}」的本机版本发布到 {target} 吗？',
      confirm_use_remote: '确定用 {target} 的版本替换「{name}」的本机状态吗？',
      plan: '差异',
      plan_empty: '两边一致，没有需要处理的内容。',
      plan_counts: '待上传 {up} · 待下载 {down} · 冲突 {conflict}',
      pick: '选择变更',
      name: '插件',
      kind: '差异',
      local: '本机',
      remote: '远端',
      baseline: '上次同步',
      action: '决定',
      apply: '应用所选变更',
      selected: '已选',
      conflicts: '需要你决定',
      conflicts_note: '两边都改过这个插件。选择保留哪一侧，另一侧会在它下次同步时处理。',
      keep_local: '保留本机',
      use_remote: '采用远端',
      keep_local_hint: '把本机版本发布到远端清单。',
      use_remote_hint: '在本机应用远端版本。',
      unavailable: '当前方向不可用',
      outcomes: '结果',
      added: '新增',
      updated: '更新',
      history: '远端备份',
      on: '已启用',
      off: '已禁用',
      install: '安装缺失插件',
      upgrade: '升级',
      enable: '启用',
      disable: '禁用',
      'local-only': '仅本机有',
      'local-update': '本机有变更',
      'remote-update': '远端有变更',
      'local-newer': '本机版本较新',
      'source-mismatch': '安装来源不同',
      'same-version-drift': '同版本不同提交',
      manual: '需手动处理',
      'local-source': '本地开发插件留在本机。',
      unpinned: '来源未固定到确切版本或提交。',
      'unsupported-source': '不支持此安装来源。',
      'no-baseline': '从未同步过，且两边内容不同。',
      divergent: '上次同步后两边都改过。',
      'local-change-not-publishable': '这次本机变更不能自动发布。',
      'restart-required': '需要重启 DSH 生效',
      'approval-required': '请到 DSH 插件管理器审核构建脚本权限。',
      overridden: '被其他设置覆盖',
      appliedStatus: '已应用',
      installedStatus: '已安装',
      backups: '备份',
      backup_manager_title: '备份数据管理',
      backup_manage: '备份管理',
      backup_now: '立即备份',
      backup_created: '备份已创建。',
      backup_note: '每次同步前都会先在本机备份，有实际变更时上传远端并保留最新 {retention} 份。',
      backup_filename: '文件名',
      backup_modified: '修改时间',
      backup_size: '大小',
      backup_actions: '操作',
      backup_time: '时间',
      backup_where: '位置',
      backup_files: '文件',
      backup_remote: '远端',
      backup_local_only: '仅本机',
      backup_empty: '还没有备份，运行一次同步或点击「立即备份」即可创建。',
      backup_remote_failed: '读取远端备份失败：{error}',
      backup_unavailable: '远端索引不可用，本机副本仍可还原。',
      backup_refresh: '刷新',
      backup_delete: '删除',
      backup_delete_selected: '删除选中 ({count})',
      backup_deleted: '备份已删除。',
      backup_select_all: '全选备份',
      backup_select_one: '选择备份 {name}',
      confirm_delete_backup: '确定删除备份 {name} 吗？删除后无法撤销。',
      confirm_delete_selected: '确定删除选中的 {count} 份备份吗？删除后无法撤销。',
      close: '关闭',
      restore: '恢复',
      restored: '备份已恢复。',
      confirm_restore: '确定恢复备份 {id} 里的插件吗？当前已安装、但该备份里没有的插件会保持现状。',
      restore_kept: '该备份未包含，保持现状。',
      failed: '失败',
      cancelled: '已取消',
      skipped: '已跳过',
      resolved: '选择已应用。',
      resolve_failed: '这次选择没有生效，请刷新差异后重试。',
      requestFailed: '请求失败。',
      invalidResponse: 'Host 返回了无效响应。',
      nothing: '—',
      mode_etag: '条件写入',
      mode_lock: 'WebDAV 锁',
    };

    const style = `
      .kds-sync{color:var(--dsw-alias-label-primary);display:grid;gap:14px;font:inherit;min-width:0}
      .kds-sync h2,.kds-sync h3,.kds-sync h4,.kds-sync p{margin:0}
      .kds-sync h2{font-size:19px;font-weight:600;letter-spacing:-0.01em}
      .kds-sync h3{font-size:14px;font-weight:600}
      .kds-sync h4{font-size:13px;font-weight:600}
      .kds-sync section,.kds-sync form{display:grid;gap:12px;min-width:0}
      .kds-sync .kds-topbar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px 16px;padding-bottom:10px;border-block-end:1px solid var(--dsw-alias-border-l1)}
      .kds-sync .kds-tabs{display:inline-flex;gap:4px;padding:3px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}
      .kds-sync .kds-tab{min-height:30px;padding:4px 14px;border:1px solid transparent;border-radius:7px;background:none;color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:500;transition:all .15s ease}
      .kds-sync .kds-tab[aria-pressed=true]{background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px rgba(0,0,0,.18)}
      .kds-sync .kds-conn-bar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px 14px;padding:10px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
      .kds-sync .kds-conn-left{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}
      .kds-sync .kds-pill{font-size:12px;padding:2px 9px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);white-space:nowrap}
      .kds-sync button{box-sizing:border-box;min-height:32px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:inherit;background:var(--dsw-alias-bg-layer-2);font:inherit;font-size:13px;padding:5px 12px;transition:all .15s ease;display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap}
      .kds-sync button:enabled{cursor:pointer}.kds-sync button:enabled:hover{filter:brightness(1.1);border-color:var(--dsw-alias-label-secondary)}
      .kds-sync button:disabled{opacity:.45}
      .kds-sync button.kds-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff;font-weight:500}
      .kds-sync button.kds-primary:enabled:hover{filter:brightness(1.08);border-color:var(--dsw-alias-brand-primary)}
      .kds-sync button.kds-ghost{border-color:transparent;background:transparent;color:var(--dsw-alias-label-secondary);padding:5px 10px}
      .kds-sync button.kds-ghost:enabled:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-color:transparent;filter:none}
      .kds-sync .kds-module{display:grid;gap:10px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);min-width:0;transition:border-color .15s ease}
      .kds-sync .kds-module:hover{border-color:var(--dsw-alias-border-l2)}
      .kds-sync .kds-module.kds-failed{border-inline-start:3px solid var(--dsw-alias-state-error-primary)}
      .kds-sync .kds-module-head{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px 12px;min-width:0}
      .kds-sync .kds-module-title{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}
      .kds-sync .kds-module-foot{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px 12px;padding-top:10px;border-block-start:1px solid var(--dsw-alias-border-l1)}
      .kds-sync .kds-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);flex:none}
      .kds-sync .kds-dot-ok{background:var(--dsw-alias-state-success-primary);box-shadow:0 0 0 3px rgba(92,186,133,.16)}
      .kds-sync .kds-dot-failed{background:var(--dsw-alias-state-error-primary);box-shadow:0 0 0 3px rgba(227,107,107,.18)}
      .kds-sync .kds-dot-pending{background:var(--dsw-alias-state-warn-primary);box-shadow:0 0 0 3px rgba(226,176,74,.16)}
      .kds-sync .kds-badge{font-size:11px;font-weight:500;padding:2px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
      .kds-sync .kds-badge-ok{color:var(--dsw-alias-state-success-primary);background:rgba(92,186,133,.14)}
      .kds-sync .kds-badge-failed{color:var(--dsw-alias-state-error-primary);background:rgba(227,107,107,.14)}
      .kds-sync .kds-badge-pending{color:var(--dsw-alias-state-warn-primary);background:rgba(226,176,74,.14)}
      .kds-sync .kds-feedback{font-size:12px;color:var(--dsw-alias-label-secondary)}
      .kds-sync .kds-feedback[data-tone=ok]{color:var(--dsw-alias-state-success-primary)}
      .kds-sync .kds-feedback[data-tone=error]{color:var(--dsw-alias-state-error-primary)}
      .kds-sync .kds-note{color:var(--dsw-alias-label-secondary);font-size:12px;font-variant-numeric:tabular-nums}
      .kds-sync .kds-module-meta{display:flex;gap:8px 12px;flex-wrap:wrap;align-items:center;min-width:0}
      .kds-sync .kds-seg{display:inline-flex;padding:2px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
      .kds-sync .kds-seg button{min-height:26px;padding:2px 10px;border:1px solid transparent;background:none;border-radius:6px;font-size:12px;color:var(--dsw-alias-label-secondary)}
      .kds-sync .kds-seg button[aria-pressed=true]{background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font-weight:500}
      .kds-sync .kds-row{display:flex;align-items:center;flex-wrap:wrap;gap:6px}
      .kds-sync .kds-fields{display:grid;gap:14px 16px;grid-template-columns:repeat(2,minmax(0,1fr));align-items:start}
      .kds-sync .kds-field{display:grid;gap:6px;align-content:start;min-width:0;font-size:12px;color:var(--dsw-alias-label-secondary)}
      .kds-sync .kds-field-wide{grid-column:1/-1}
      .kds-sync .kds-field-narrow{max-width:220px}
      .kds-sync .kds-help{margin:0}
      .kds-sync .kds-check{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--dsw-alias-label-primary)}
      .kds-sync .kds-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding-block-start:4px}
      @media (max-width:640px){.kds-sync .kds-fields{grid-template-columns:1fr}.kds-sync .kds-field-wide{grid-column:auto}}
      .kds-sync input:not([type=checkbox]),.kds-sync select{box-sizing:border-box;width:100%;height:34px;min-height:34px;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit}
      .kds-sync input[type=checkbox]{width:15px;height:15px;accent-color:var(--dsw-alias-brand-primary);cursor:pointer;margin:0}
      .kds-sync .kds-table{overflow-x:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
      .kds-sync table{width:100%;border-collapse:collapse;text-align:start;font-variant-numeric:tabular-nums}
      .kds-sync thead{background:var(--dsw-alias-bg-layer-2)}
      .kds-sync th,.kds-sync td{padding:10px 12px;text-align:start;vertical-align:middle;border-block-end:1px solid var(--dsw-alias-border-l1)}
      .kds-sync th{font-size:12px;color:var(--dsw-alias-label-secondary);font-weight:600;white-space:nowrap}
      .kds-sync tbody tr{transition:background .12s ease}
      .kds-sync tbody tr:hover{background:rgba(255,255,255,.025)}
      .kds-sync tbody tr:last-child td{border-block-end:0}
      .kds-sync td small{display:block;margin-top:3px;color:var(--dsw-alias-label-secondary)}
      .kds-sync .kds-nowrap{white-space:nowrap}
      .kds-sync .kds-endpoint{overflow-wrap:anywhere;font-size:13px;color:var(--dsw-alias-label-primary)}
      .kds-sync .kds-error{color:var(--dsw-alias-state-error-primary);font-size:12px}
      .kds-sync button.kds-danger{border-color:rgba(227,107,107,.55);color:var(--dsw-alias-state-error-primary);background:rgba(227,107,107,.14);font-weight:500}
      .kds-sync button.kds-danger:enabled:hover{background:rgba(227,107,107,.24);border-color:var(--dsw-alias-state-error-primary);filter:none}
      .kds-sync button.kds-link-btn{min-height:26px;padding:3px 8px;border-color:transparent;background:transparent;font-size:13px;color:var(--dsw-alias-brand-primary);font-weight:500}
      .kds-sync button.kds-link-btn:enabled:hover{background:rgba(111,143,255,.12);border-color:transparent;filter:none}
      .kds-sync button.kds-link-danger{color:var(--dsw-alias-state-error-primary)}
      .kds-sync button.kds-link-danger:enabled:hover{background:rgba(227,107,107,.12)}
      .kds-sync .kds-modal-backdrop{position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.62);backdrop-filter:blur(3px);display:grid;place-items:center;padding:20px}
      .kds-sync .kds-modal{box-sizing:border-box;width:min(820px,100%);max-height:85vh;display:grid;grid-template-rows:auto auto 1fr auto;gap:14px;padding:20px 22px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 24px 64px rgba(0,0,0,.48);overflow:hidden}
      .kds-sync .kds-modal-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
      .kds-sync .kds-modal-head h3{font-size:17px;font-weight:600;letter-spacing:-0.01em}
      .kds-sync .kds-modal-close{min-height:30px;min-width:30px;padding:0;border-color:transparent;background:transparent;border-radius:8px;font-size:18px;line-height:1;color:var(--dsw-alias-label-secondary)}
      .kds-sync .kds-modal-close:enabled:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-color:transparent;filter:none}
      .kds-sync .kds-modal-body{overflow:auto;min-height:0;display:grid;gap:10px;align-content:start}
      .kds-sync .kds-modal-foot{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;padding-top:6px;border-block-start:1px solid var(--dsw-alias-border-l1)}
      .kds-sync .kds-filename{max-width:250px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:inline-block;vertical-align:middle;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px}
      .kds-sync .kds-cell-name{display:flex;align-items:center;gap:8px;min-width:0}
    `;

    // ---- helpers ------------------------------------------------------
    const isDirection = value => DIRECTIONS.some(item => item.id === value);

    /** Mirrors the Host split so a response without the two fields still fills both inputs. */
    function splitWebdavUrl(value) {
      const text = typeof value === 'string' ? value.trim() : '';
      if (!text) return {address: '', dir: ''};
      try {
        const parsed = new URL(text);
        if (parsed.protocol !== 'https:') return {address: text, dir: ''};
        let dir = parsed.pathname;
        try { dir = decodeURIComponent(dir); } catch { /* keep the encoded path */ }
        // A root path means "no folder"; every other path is kept exactly as written, slashes included.
        return {address: parsed.origin, dir: dir === '/' ? '' : dir};
      } catch {
        return {address: text, dir: ''};
      }
    }

    function formatSide(side, t) {
      if (side == null || side === '') return t('nothing');
      if (typeof side !== 'object') return String(side);
      const parts = [];
      if (side.version) parts.push(side.version);
      if (typeof side.enabled === 'boolean') parts.push(t(side.enabled ? 'on' : 'off'));
      if (side.spec) parts.push(side.spec);
      return parts.length ? parts.join(' · ') : t('nothing');
    }

    function stateOf(saved, overview) {
      if (!saved) return 'idle';
      const attempt = overview?.lastAttempt;
      if (attempt?.direction && attempt.direction !== saved.direction) return 'idle';
      if (attempt?.status === 'failed') return 'failed';
      if (attempt?.status === 'pending' || Number(overview?.conflictCount) > 0) return 'pending';
      if (attempt && (attempt.status === 'ok' || attempt.status === 'success')) return 'ok';
      return 'idle';
    }

    function targetLabel(saved) {
      if (!saved) return '';
      if (saved.transport === 'git') {
        const repo = saved.git?.repo || '';
        const branch = saved.git?.branch || '';
        return branch ? `${repo} @ ${branch}` : repo;
      }
      return saved.url || '';
    }

    function configuredOf(saved) {
      if (!saved) return false;
      return saved.transport === 'git' ? !!saved.git?.repo : !!saved.url;
    }

    function normalize(value) {
      if (!value || typeof value !== 'object') throw new Error('invalidResponse');
      const git = value.git && typeof value.git === 'object' ? value.git : {};
      const transport = value.transport === 'git' ? 'git' : 'webdav';
      const parts = splitWebdavUrl(value.url);
      return {
        transport,
        url: value.url || '',
        address: typeof value.address === 'string' ? value.address : parts.address,
        dir: typeof value.dir === 'string' ? value.dir : parts.dir,
        username: value.username || '',
        passwordSet: value.passwordSet === true,
        retention: String(value.retention ?? 10),
        autoApply: value.autoApply === true,
        webdavAutoApply: value.webdavAutoApply === true,
        direction: isDirection(value.direction) ? value.direction : 'both',
        git: {
          repo: git.repo || '',
          branch: git.branch || 'main',
          auth: git.auth === 'https' ? 'https' : 'ssh',
          gitUsername: git.gitUsername || '',
          tokenSet: git.tokenSet === true,
          authorName: git.authorName || 'DSH Sync',
          authorEmail: git.authorEmail || 'dsh-sync@localhost',
          autoApply: git.autoApply === true,
        },
        overview: value.overview && typeof value.overview === 'object' ? value.overview : null,
        modules: value.modules && typeof value.modules === 'object' ? value.modules : {},
      };
    }

    async function request(action, fields, signal) {
      const response = await fetch('/kamisangk-dsh-sync/api', {
        method: 'POST',
        signal,
        credentials: 'same-origin',
        headers: {'content-type': 'application/json', 'x-dsh-sync': '1'},
        body: JSON.stringify({action, ...fields}),
      });
      const body = await response.json().catch(() => null);
      if (typeof body?.error === 'string' && body.error && (!response.ok || body.ok === false)) throw new Error(body.error);
      if (!response.ok) throw new Error(`requestFailed|HTTP ${response.status}`);
      if (body?.ok !== true) throw new Error('invalidResponse');
      return body.value;
    }

    function Table({label, columns, rows, t}) {
      return h('div', {className: 'kds-table', tabIndex: 0, role: 'group', 'aria-label': t(label)}, h('table', null,
        h('thead', null, h('tr', null, ...columns.map(column => h('th', {key: column, scope: 'col'}, t(column))))),
        h('tbody', null, ...rows)));
    }

    function formatBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes < 0) return '—';
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    function formatDateTime(iso, fallback) {
      if (!iso) return fallback || '—';
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return fallback || String(iso);
      const pad = n => String(n).padStart(2, '0');
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
        `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    }

    // ---- page ---------------------------------------------------------
    function SettingsPage({locale, t}) {
      useSyncExternalStore(locale.subscribe.bind(locale), locale.getSnapshot.bind(locale));
      const [page, setPage] = useState('sync');
      const [saved, setSaved] = useState(null);
      const [draft, setDraft] = useState(null);
      const [overview, setOverview] = useState(null);
      const [plan, setPlan] = useState(null);
      const [planOpen, setPlanOpen] = useState(false);
      const [selected, setSelected] = useState(() => new Set());
      const [outcomes, setOutcomes] = useState([]);
      const [backups, setBackups] = useState(null);
      const [busy, setBusy] = useState('status');
      const [message, setMessage] = useState('');
      const [error, setError] = useState('');
      const [noticePage, setNoticePage] = useState(null);
      const [backupModalOpen, setBackupModalOpen] = useState(false);
      const [backupCategory, setBackupCategory] = useState('plugins');
      const [selectedBackups, setSelectedBackups] = useState(() => new Set());
      const [modOverviews, setModOverviews] = useState({});
      const [modPlans, setModPlans] = useState({});
      const [modOpen, setModOpen] = useState({});
      const [modSelected, setModSelected] = useState({});
      const [modOutcomes, setModOutcomes] = useState({});
      const active = useRef(null);
      const id = useId();

      const configured = configuredOf(saved);
      const dirty = !!draft && (() => {
        if (!saved) return false;
        if (draft.transport !== saved.transport) return true;
        if (draft.transport === 'git') {
          return ['repo', 'branch', 'auth', 'gitUsername', 'authorName', 'authorEmail'].some(key => draft.git[key] !== saved.git[key])
            || !!draft.git.token || draft.git.autoApply !== saved.git.autoApply || draft.retention !== saved.retention;
        }
        return ['address', 'dir', 'username', 'retention'].some(key => draft[key] !== saved[key])
          || !!draft.password || draft.autoApply !== saved.webdavAutoApply;
      })();
      const blocked = !!busy || dirty || !configured;
      const direction = saved?.direction ?? 'both';
      const state = stateOf(configured ? saved : null, overview ?? saved?.overview);

      function applySettings(value) {
        const next = normalize(value);
        const previous = saved;
        setSaved(next);
        setDraft({...next, password: '', git: {...next.git, token: ''}});
        if (next.overview) setOverview(next.overview);
        if (next.modules) {
          const nextModOv = {};
          for (const [k, v] of Object.entries(next.modules)) if (v?.overview) nextModOv[k] = v.overview;
          setModOverviews(nextModOv);
        }
        const targetChanged = !previous || previous.transport !== next.transport
          || (next.transport === 'git' ? previous.git.repo !== next.git.repo || previous.git.branch !== next.git.branch
            : previous.address !== next.address || previous.dir !== next.dir || previous.username !== next.username);
        const directionChanged = previous?.direction !== next.direction;
        if (targetChanged) {
          setOverview(next.overview ?? null);
          setBackups(null);
        }
        if (targetChanged || directionChanged) {
          setPlan(null);
          setPlanOpen(false);
          setSelected(new Set());
          setOutcomes([]);
        }
      }

      async function run(action, execute, success = '') {
        if (active.current) return;
        const controller = new AbortController();
        active.current = controller;
        setBusy(action);
        setError('');
        setMessage('');
        setNoticePage(NOTICE_PAGE[action] ?? page);
        try {
          await execute(controller.signal);
          if (!controller.signal.aborted) setMessage(success);
        } catch (cause) {
          if (!controller.signal.aborted) {
            setError(cause instanceof Error ? cause.message : 'requestFailed');
            if (['sync', 'apply', 'resolve'].includes(action)) {
              setPlan(null);
              setPlanOpen(false);
              setSelected(new Set());
              const value = await request('status', {}, controller.signal).catch(() => null);
              if (!controller.signal.aborted && value?.overview) setOverview(value.overview);
            }
          }
        } finally {
          if (active.current === controller) {
            active.current = null;
            setBusy('');
          }
        }
      }

      // Backup listing is secondary: a failure shows inside the card instead of
      // replacing the plugin status, and a stale list is better than none.
      async function refreshBackups(signal, category = backupCategory) {
        try {
          const result = await request('backups', {category}, signal);
          setBackups(result);
          const validIds = new Set((result?.items ?? []).map(item => item.id));
          setSelectedBackups(previous => {
            const next = new Set();
            for (const itemId of previous) if (validIds.has(itemId)) next.add(itemId);
            return next;
          });
        } catch (cause) {
          if (!signal?.aborted) {
            setBackups({category, items: [], snapshots: [], local: [], error: cause instanceof Error ? cause.message : 'requestFailed'});
          }
        }
      }

      function loadBackups(category = backupCategory) {
        if (!configured) return;
        void run('backups', signal => refreshBackups(signal, category));
      }

      function openBackupModal(category = 'plugins') {
        if (!configured || dirty) return;
        setBackupCategory(category);
        setSelectedBackups(new Set());
        setBackupModalOpen(true);
        loadBackups(category);
      }

      function createBackupNow() {
        if (blocked) return;
        void run('backup_create', async signal => {
          const result = await request('backup_create', {category: backupCategory}, signal);
          if (result?.listing) setBackups(result.listing);
          else await refreshBackups(signal, backupCategory);
        }, 'backup_created');
      }

      function deleteBackups(ids, singleName) {
        if (blocked || !ids.length) return;
        const promptText = ids.length === 1
          ? t('confirm_delete_backup').replace('{name}', singleName || ids[0])
          : t('confirm_delete_selected').replace('{count}', String(ids.length));
        if (!window.confirm(promptText)) return;
        void run('backup_delete', async signal => {
          const result = await request('backup_delete', {category: backupCategory, ids, deleteLocal: true}, signal);
          if (result?.items) {
            setBackups(result);
            setSelectedBackups(new Set());
          } else {
            await refreshBackups(signal, backupCategory);
          }
        }, 'backup_deleted');
      }

      function load() {
        return run('status', async signal => {
          const value = await request('status', {}, signal);
          applySettings(value);
          if (configuredOf(value)) await refreshBackups(signal);
        });
      }

      // Feedback belongs to the view that started the action, so switching tabs
      // never carries a stale sentence to the other page.
      function go(next) {
        if (next === page) return;
        setPage(next);
        setMessage('');
        setError('');
        setNoticePage(null);
      }

      function feedback() {
        if (noticePage !== page) return null;
        if (error) {
          return h('p', {className: 'kds-feedback', role: 'alert', 'data-tone': 'error'},
            t(errorKey), errorDetail && ` (${errorDetail})`);
        }
        const text = busy ? t('loading') : message ? t(message) : '';
        return text ? h('p', {className: 'kds-feedback', role: 'status', 'data-tone': message ? 'ok' : undefined}, text) : null;
      }

      useEffect(() => {
        void load();
        return () => {
          active.current?.abort();
          active.current = null;
        };
      }, []);

      function field(key, value) {
        setDraft(previous => ({...previous, [key]: value}));
      }

      function gitField(key, value) {
        setDraft(previous => ({...previous, git: {...previous.git, [key]: value}}));
      }

      function chooseTransport(transport) {
        if (busy || !saved) return;
        setDraft(previous => ({
          ...previous,
          transport,
          autoApply: transport === 'git' ? previous.git.autoApply : previous.webdavAutoApply,
        }));
      }

      // The Host rejects a bad collection URL too; checking here keeps the message local and specific.
      function targetProblem() {
        const address = draft.address.trim();
        const dir = draft.dir.trim();
        if (!address) return 'address_required';
        if (/[?#\\]/.test(address)) return 'address_invalid';
        let parsed;
        try { parsed = new URL(address); } catch { return 'address_invalid'; }
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return 'address_invalid';
        if (/[?#\\]/.test(dir) || dir.split('/').some(segment => segment === '.' || segment === '..')) return 'dir_invalid';
        return '';
      }

      function save(event) {
        event?.preventDefault?.();
        if (!draft || busy || !dirty) return;
        const retention = Number(draft.retention);
        if (!/^[0-9]+$/.test(String(draft.retention)) || !Number.isSafeInteger(retention) || retention < 0 || retention > 50) {
          setError('invalid_retention');
          return;
        }
        if (draft.transport === 'webdav') {
          const problem = targetProblem();
          if (problem) {
            setError(problem);
            return;
          }
        }
        if (draft.transport === 'git' && !draft.git.repo.trim()) {
          setError('git_repo_required');
          return;
        }
        void run('save', async signal => {
          const value = draft.transport === 'git'
            ? await request('save', {
              transport: 'git',
              retention,
              autoApply: draft.git.autoApply,
              git: {
                repo: draft.git.repo.trim(),
                branch: draft.git.branch.trim() || 'main',
                auth: draft.git.auth,
                gitUsername: draft.git.gitUsername.trim(),
                authorName: draft.git.authorName.trim() || 'DSH Sync',
                authorEmail: draft.git.authorEmail.trim() || 'dsh-sync@localhost',
                ...(draft.git.token ? {token: draft.git.token} : {}),
              },
            }, signal)
            : await request('save', {
              transport: 'webdav',
              address: draft.address.trim(),
              dir: draft.dir.trim(),
              username: draft.username.trim(),
              retention,
              autoApply: draft.autoApply,
              ...(draft.password ? {password: draft.password} : {}),
            }, signal);
          applySettings(value);
          setPlan(null);
          setPlanOpen(false);
          setSelected(new Set());
          setOutcomes([]);
        }, 'saved');
      }

      function adopt(value, open = true) {
        if (!value || !Array.isArray(value.items)) throw new Error('invalidResponse');
        if (value.overview && typeof value.overview === 'object') setOverview(value.overview);
        setPlan(value);
        setPlanOpen(open);
        setSelected(new Set(value.items.filter(item => item.selectable === true && item.kind === 'install').map(item => item.id)));
        setOutcomes(Array.isArray(value.outcomes) ? value.outcomes : []);
      }

      function syncNow() {
        if (blocked) return;
        // All three directions run through the same Host action; the Host applies the saved rule.
        void run('sync', async signal => {
          adopt(await request('sync', {expectedDirection: direction, expectedTarget: targetLabel(saved)}, signal), false);
          await refreshBackups(signal);
        }, 'sync_done');
      }

      function preview() {
        if (blocked) return;
        void run('preview', async signal => {
          adopt(await request('preview', {}, signal));
        });
      }

      function changeDirection(next) {
        if (!saved || busy || !configured || next === direction) return;
        void run('direction', async signal => {
          const value = await request('direction', {direction: next}, signal);
          applySettings(value && typeof value === 'object' ? value : await request('status', {}, signal));
        }, 'direction_saved');
      }

      function applyPlan() {
        if (!plan || blocked || !plan.id || !selected.size) return;
        const ids = plan.items.filter(item => item.selectable && selected.has(item.id)).map(item => item.id);
        if (!ids.length) return;
        const planId = plan.id;
        void run('apply', async signal => {
          const value = await request('apply', {id: planId, selected: ids}, signal);
          setOutcomes(Array.isArray(value?.outcomes) ? value.outcomes : []);
          if (value?.overview) setOverview(value.overview);
          setPlan(null);
          setSelected(new Set());
        });
      }

      function resolve(item, choice) {
        if (!plan?.id || blocked) return;
        const question = t(choice === 'local' ? 'confirm_keep_local' : 'confirm_use_remote')
          .replace('{name}', item.name)
          .replace('{target}', targetLabel(saved));
        if (!window.confirm(question)) return;
        const planId = plan.id;
        void run('resolve', async signal => {
          try {
            const value = await request('resolve', {id: planId, name: item.name, choice}, signal);
            if (!value || !Array.isArray(value.items)) throw new Error('invalidResponse');
            adopt(value);
          } catch (cause) {
            setPlan(null);
            setSelected(new Set());
            throw new Error(`${cause instanceof Error ? cause.message : ''} · ${t('resolve_failed')}`);
          }
        }, 'resolved');
      }

      // ---- render: shared -------------------------------------------
      const button = (label, onClick, disabled, props = {}) => h('button', {type: 'button', onClick, disabled, ...props}, t(label));

      function badge(kind, label) {
        return h('span', {className: `kds-badge kds-badge-${kind}`}, t(label));
      }

      function statusBadge(kind) {
        if (kind === 'ok') return badge('ok', 'badge_ok');
        if (kind === 'failed') return badge('failed', 'badge_failed');
        if (kind === 'pending') return badge('pending', 'badge_pending');
        return badge('idle', 'badge_idle');
      }

      // ---- render: sync page ----------------------------------------
      function planView() {
        const items = plan.items;
        if (items.length === 0) return h('p', {className: 'kds-note'}, t('plan_empty'));
        const conflicts = items.filter(item => item.kind === 'conflict');
        const pickable = items.filter(item => item.selectable === true && item.kind !== 'conflict');
        const counts = {
          up: items.filter(item => ['local-only', 'local-update'].includes(item.kind)).length,
          down: items.filter(item => ['install', 'upgrade', 'enable', 'disable'].includes(item.kind)).length,
          conflict: conflicts.length,
        };
        const pickRows = pickable.map(item => h('tr', {key: item.id},
          h('td', null, h('input', {
            type: 'checkbox', checked: selected.has(item.id), disabled: !!busy,
            'aria-label': `${t('pick')} · ${item.name} · ${t(item.kind)}`,
            onChange: event => setSelected(previous => {
              const next = new Set(previous);
              if (event.target.checked) next.add(item.id); else next.delete(item.id);
              return next;
            }),
          })),
          h('td', null, item.name),
          h('td', null, t(item.kind), item.reason && item.reason !== item.kind && h('small', null, t(item.reason))),
          h('td', null, formatSide(item.local, t)),
          h('td', null, formatSide(item.remote, t))));
        const conflictRows = conflicts.map(item => h('tr', {key: item.id},
          h('td', null, item.name, item.reason && h('small', null, t(item.reason))),
          h('td', null, formatSide(item.local, t)),
          h('td', null, formatSide(item.remote, t)),
          h('td', null, formatSide(item.baseline, t)),
          h('td', null, h('div', {className: 'kds-row'},
            button('keep_local', () => resolve(item, 'local'), blocked || item.canPublishLocal !== true, {
              title: t(item.canPublishLocal ? 'keep_local_hint' : 'unavailable'),
            }),
            button('use_remote', () => resolve(item, 'remote'), blocked || item.canApplyRemote !== true, {
              title: t(item.canApplyRemote ? 'use_remote_hint' : 'unavailable'),
            })))));
        return h('section', {'aria-label': t('plan')},
          h('h4', null, t('plan')),
          h('p', {className: 'kds-note'}, t('plan_counts')
            .replace('{up}', String(counts.up)).replace('{down}', String(counts.down)).replace('{conflict}', String(counts.conflict))),
          pickable.length > 0 && h(Table, {label: 'plan', columns: ['pick', 'name', 'kind', 'local', 'remote'], t, rows: pickRows}),
          pickable.length > 0 && h('div', {className: 'kds-row'},
            button('apply', applyPlan, blocked || !plan.id || selected.size === 0, {className: 'kds-primary'}),
            h('span', {className: 'kds-note'}, `${t('selected')} · ${selected.size}`)),
          conflicts.length > 0 && h('section', {'aria-label': t('conflicts')},
            h('h4', null, t('conflicts')),
            h('p', {className: 'kds-note'}, t('conflicts_note')),
            h(Table, {label: 'conflicts', columns: ['name', 'local', 'remote', 'baseline', 'action'], t, rows: conflictRows})));
      }

      function pluginCard() {
        const kind = state;
        const attempt = overview?.lastAttempt;
        const failReason = kind === 'failed' ? (attempt?.error || t('failed')) : '';
        const meta = Number.isFinite(overview?.localCount) && Number.isFinite(overview?.remoteCount)
          ? t('meta_plugins').replace('{local}', String(overview.localCount)).replace('{remote}', String(overview.remoteCount))
          : t('scope_plugins_detail');
        return h('section', {className: `kds-module${kind === 'failed' ? ' kds-failed' : ''}`, 'aria-labelledby': `${id}-plugins`},
          h('div', {className: 'kds-module-head'},
            h('div', {className: 'kds-module-title'},
              h('span', {className: `kds-dot kds-dot-${kind === 'ok' ? 'ok' : kind === 'failed' ? 'failed' : kind === 'pending' ? 'pending' : 'idle'}`, 'aria-hidden': true}),
              h('h3', {id: `${id}-plugins`}, t('scope_plugins')),
              configured ? statusBadge(kind) : badge('idle', 'badge_unconfigured'),
              h('span', {className: 'kds-note'}, meta)),
            h('div', {className: 'kds-seg', role: 'group', 'aria-label': t('transport')},
              ...DIRECTIONS.map(item => h('button', {
                key: item.id, type: 'button',
                'aria-pressed': direction === item.id,
                disabled: !!busy || !configured || dirty,
                onClick: () => changeDirection(item.id),
              }, t(item.label))))),
          kind === 'failed' && h('p', {className: 'kds-error'}, t('last_attempt_failed').replace('{error}', failReason)),
          feedback(),
          h('div', {className: 'kds-module-foot'},
            h('span', {className: 'kds-note'}, attempt?.at
              ? t('last_attempt').replace('{time}', formatDateTime(attempt.at))
              : t('never_synced')),
            h('div', {className: 'kds-row'},
              configured && button('backup_manage', () => openBackupModal('plugins'), blocked, {className: 'kds-ghost'}),
              configured && h('button', {
                type: 'button', className: 'kds-ghost', disabled: blocked,
                onClick: () => (plan ? setPlanOpen(!planOpen) : preview()),
                'aria-expanded': !!plan && planOpen,
              }, plan && planOpen ? t('hide_details') : t('show_details')),
              configured && button(kind === 'failed' ? 'retry' : 'sync', syncNow, blocked, {className: 'kds-primary'}))),
          plan && planOpen && planView(),
          outcomes.length > 0 && h('section', {'aria-label': t('outcomes')},
            h('h4', null, t('outcomes')),
            h('ul', null, ...outcomes.map((result, index) => h('li', {key: `${result.name}-${index}`},
              `${result.name} · ${t(result.status === 'applied' ? (result.kind === 'install' ? 'installedStatus' : 'appliedStatus') : result.status)}`,
              result.detail && h('small', null, ` · ${result.detail}`))))));
      }

      function formatModSide(side) {
        if (!side) return t('nothing');
        if (side.files) return `${Object.keys(side.files).length} files · ${String(side.sha256 ?? '').slice(0, 8)}`;
        return `${side.source ?? 'config'} · ${String(side.sha256 ?? '').slice(0, 8)}`;
      }

      function changeModuleDirection(category, nextDir) {
        if (blocked) return;
        void run('direction', async signal => {
          const value = await request('direction', {category, direction: nextDir}, signal);
          applySettings(value);
          setModPlans(prev => ({...prev, [category]: null}));
          setModOpen(prev => ({...prev, [category]: false}));
          setModSelected(prev => ({...prev, [category]: new Set()}));
        }, 'direction_saved');
      }

      function previewModule(category) {
        if (blocked) return;
        void run('preview', async signal => {
          const value = await request('preview', {category}, signal);
          if (value?.overview) setModOverviews(prev => ({...prev, [category]: value.overview}));
          setModPlans(prev => ({...prev, [category]: value}));
          setModOpen(prev => ({...prev, [category]: true}));
          setModSelected(prev => ({...prev, [category]: new Set((value?.items ?? []).filter(i => i.kind === 'install').map(i => i.id))}));
        });
      }

      function syncModule(category) {
        if (blocked) return;
        void run('sync', async signal => {
          const value = await request('sync', {category}, signal);
          if (value?.overview) setModOverviews(prev => ({...prev, [category]: value.overview}));
          setModPlans(prev => ({...prev, [category]: value}));
          setModOutcomes(prev => ({...prev, [category]: Array.isArray(value?.outcomes) ? value.outcomes : []}));
          setModSelected(prev => ({...prev, [category]: new Set((value?.items ?? []).filter(i => i.kind === 'install').map(i => i.id))}));
        }, 'sync_done');
      }

      function applyModulePlan(category) {
        const curPlan = modPlans[category];
        const curSel = modSelected[category] ?? new Set();
        if (blocked || !curPlan?.id || curSel.size === 0) return;
        void run('apply', async signal => {
          const value = await request('apply', {category, id: curPlan.id, selected: [...curSel]}, signal);
          if (value?.overview) setModOverviews(prev => ({...prev, [category]: value.overview}));
          setModOutcomes(prev => ({...prev, [category]: Array.isArray(value?.outcomes) ? value.outcomes : []}));
          setModPlans(prev => ({...prev, [category]: null}));
          setModOpen(prev => ({...prev, [category]: false}));
          setModSelected(prev => ({...prev, [category]: new Set()}));
        }, 'appliedStatus');
      }

      function resolveModule(category, item, choice) {
        const curPlan = modPlans[category];
        if (blocked || !curPlan?.id) return;
        const question = t(choice === 'local' ? 'confirm_keep_local' : 'confirm_use_remote')
          .replace('{name}', item.name).replace('{target}', targetLabel(saved));
        if (!window.confirm(question)) return;
        void run('resolve', async signal => {
          const value = await request('resolve', {category, id: curPlan.id, name: item.id, choice}, signal);
          if (value?.overview) setModOverviews(prev => ({...prev, [category]: value.overview}));
          setModPlans(prev => ({...prev, [category]: value}));
          setModOutcomes(prev => ({...prev, [category]: Array.isArray(value?.outcomes) ? value.outcomes : []}));
        }, 'resolved');
      }

      function modulePlanView(category, curPlan) {
        const items = curPlan.items ?? [];
        if (items.length === 0) return h('p', {className: 'kds-note'}, t('plan_empty'));
        const curSel = modSelected[category] ?? new Set();
        const conflicts = items.filter(item => item.kind === 'conflict');
        const pickable = items.filter(item => item.selectable === true && item.kind !== 'conflict');
        const pickRows = pickable.map(item => h('tr', {key: item.id},
          h('td', null, h('input', {
            type: 'checkbox', checked: curSel.has(item.id), disabled: !!busy,
            onChange: event => setModSelected(prev => {
              const next = new Set(prev[category] ?? []);
              if (event.target.checked) next.add(item.id); else next.delete(item.id);
              return {...prev, [category]: next};
            }),
          })),
          h('td', null, item.name),
          h('td', null, t(item.kind)),
          h('td', null, formatModSide(item.local)),
          h('td', null, formatModSide(item.remote))));
        const conflictRows = conflicts.map(item => h('tr', {key: item.id},
          h('td', null, item.name, item.reason && h('small', null, t(item.reason))),
          h('td', null, formatModSide(item.local)),
          h('td', null, formatModSide(item.remote)),
          h('td', null, formatModSide(item.baseline)),
          h('td', null, h('div', {className: 'kds-row'},
            button('keep_local', () => resolveModule(category, item, 'local'), blocked || item.canPublishLocal !== true),
            button('use_remote', () => resolveModule(category, item, 'remote'), blocked || item.canApplyRemote !== true)))));
        return h('section', {'aria-label': t('plan')},
          h('h4', null, t('plan')),
          pickable.length > 0 && h(Table, {label: `${category}-plan`, columns: ['pick', 'item_col', 'kind', 'local', 'remote'], t, rows: pickRows}),
          pickable.length > 0 && h('div', {className: 'kds-row'},
            button('apply', () => applyModulePlan(category), blocked || !curPlan.id || curSel.size === 0, {className: 'kds-primary'}),
            h('span', {className: 'kds-note'}, `${t('selected')} · ${curSel.size}`)),
          conflicts.length > 0 && h('section', {'aria-label': t('conflicts')},
            h('h4', null, t('conflicts')),
            h(Table, {label: `${category}-conflicts`, columns: ['item_col', 'local', 'remote', 'baseline', 'action'], t, rows: conflictRows})));
      }

      function reservedCards() {
        return h('div', {className: 'kds-reserved-list', style: {display: 'grid', gap: 12}},
          ...SCOPES.filter(scope => scope.id !== 'plugins').map(scope => {
            const cat = scope.id;
            const modSaved = saved?.modules?.[cat] ?? {};
            const modOv = modOverviews[cat] ?? modSaved.overview ?? null;
            const modDir = modSaved.direction ?? 'both';
            const kind = stateOf(configured ? saved : null, modOv);
            const attempt = modOv?.lastAttempt;
            const curPlan = modPlans[cat];
            const isOpen = !!modOpen[cat];
            const curOutcomes = modOutcomes[cat] ?? [];
            const meta = Number.isFinite(modOv?.localCount) && Number.isFinite(modOv?.remoteCount)
              ? t('meta_items').replace('{local}', String(modOv.localCount)).replace('{remote}', String(modOv.remoteCount))
              : t(`scope_${cat}_detail`);
            return h('section', {className: `kds-module${kind === 'failed' ? ' kds-failed' : ''}`, key: cat, 'aria-labelledby': `${id}-${cat}`},
              h('div', {className: 'kds-module-head'},
                h('div', {className: 'kds-module-title'},
                  h('span', {className: `kds-dot kds-dot-${kind === 'ok' ? 'ok' : kind === 'failed' ? 'failed' : kind === 'pending' ? 'pending' : 'idle'}`, 'aria-hidden': true}),
                  h('h3', {id: `${id}-${cat}`}, t(`scope_${cat}`)),
                  configured ? statusBadge(kind) : badge('idle', 'badge_unconfigured'),
                  h('span', {className: 'kds-note'}, meta)),
                h('div', {className: 'kds-seg', role: 'group', 'aria-label': t(`scope_${cat}`)},
                  ...DIRECTIONS.map(item => h('button', {
                    key: item.id, type: 'button',
                    'aria-pressed': modDir === item.id,
                    disabled: !!busy || !configured || dirty,
                    onClick: () => changeModuleDirection(cat, item.id),
                  }, t(item.label))))),
              h('div', {className: 'kds-module-foot'},
                h('span', {className: 'kds-note'}, attempt?.at
                  ? t('last_attempt').replace('{time}', formatDateTime(attempt.at))
                  : t('never_synced')),
                h('div', {className: 'kds-row'},
                  configured && button('backup_manage', () => openBackupModal(cat), blocked, {className: 'kds-ghost'}),
                  configured && h('button', {
                    type: 'button', className: 'kds-ghost', disabled: blocked,
                    onClick: () => (curPlan ? setModOpen(prev => ({...prev, [cat]: !prev[cat]})) : previewModule(cat)),
                    'aria-expanded': !!curPlan && isOpen,
                  }, curPlan && isOpen ? t('hide_details') : t('show_details')),
                  configured && button(kind === 'failed' ? 'retry' : 'sync', () => syncModule(cat), blocked, {className: 'kds-primary'}))),
              curPlan && isOpen && modulePlanView(cat, curPlan),
              curOutcomes.length > 0 && h('section', {'aria-label': t('outcomes')},
                h('h4', null, t('outcomes')),
                h('ul', null, ...curOutcomes.map((result, idx) => h('li', {key: `${result.name}-${idx}`},
                  `${result.name} · ${t(result.status === 'applied' ? 'appliedStatus' : result.status)}`,
                  result.detail && h('small', null, ` · ${result.detail}`))))));
          }));
      }

      function restore(snapshotId, displayName) {
        if (blocked) return;
        const msg = backupCategory === 'plugins'
          ? t('confirm_restore').replace('{id}', displayName || snapshotId)
          : t('confirm_restore_module').replace('{id}', displayName || snapshotId).replace('{category}', t(`scope_${backupCategory}`));
        if (!window.confirm(msg)) return;
        void run('restore', async signal => {
          const value = await request('restore', {category: backupCategory, id: snapshotId}, signal);
          if (backupCategory === 'plugins') {
            if (value?.overview) setOverview(value.overview);
            const kept = Array.isArray(value?.extra)
              ? value.extra.map(name => ({name, status: 'skipped', detail: t('restore_kept')}))
              : [];
            setOutcomes([...(Array.isArray(value?.outcomes) ? value.outcomes : []), ...kept]);
            setPlan(null);
            setPlanOpen(false);
            setSelected(new Set());
          } else {
            if (value?.overview) setModOverviews(prev => ({...prev, [backupCategory]: value.overview}));
            setModOutcomes(prev => ({...prev, [backupCategory]: Array.isArray(value?.outcomes) ? value.outcomes : []}));
            setModPlans(prev => ({...prev, [backupCategory]: null}));
            setModOpen(prev => ({...prev, [backupCategory]: false}));
          }
          await refreshBackups(signal, backupCategory);
        }, 'restored');
      }

      function normalizeBackupItems() {
        if (Array.isArray(backups?.items)) return backups.items;
        const remote = new Map((backups?.snapshots ?? []).map(item => [item.id, item]));
        const localSet = new Set(backups?.local ?? []);
        const ids = [...new Set([...remote.keys(), ...localSet])].sort().reverse();
        return ids.map(snapshotId => {
          const found = remote.get(snapshotId);
          const bytes = found
            ? (Number.isFinite(found.totalBytes) ? found.totalBytes : (found.files ?? []).reduce((s, f) => s + (f.bytes ?? 0), 0))
            : 0;
          return {
            id: snapshotId,
            name: found?.name ?? `dsh-${backupCategory}.${snapshotId}`,
            createdAt: found?.createdAt ?? null,
            totalBytes: bytes,
            fileCount: found?.files?.length ?? 0,
            location: found ? (localSet.has(snapshotId) ? 'both' : 'remote') : 'local',
          };
        });
      }

      function backupModal() {
        if (!backupModalOpen) return null;
        const items = normalizeBackupItems();
        const allSelected = items.length > 0 && items.every(item => selectedBackups.has(item.id));
        const toggleAll = checked => {
          setSelectedBackups(checked ? new Set(items.map(item => item.id)) : new Set());
        };
        const toggleOne = (snapshotId, checked) => {
          setSelectedBackups(previous => {
            const next = new Set(previous);
            if (checked) next.add(snapshotId); else next.delete(snapshotId);
            return next;
          });
        };
        const rows = items.map(item => h('tr', {key: item.id},
          h('td', null, h('input', {
            type: 'checkbox',
            checked: selectedBackups.has(item.id),
            disabled: !!busy,
            'aria-label': t('backup_select_one').replace('{name}', item.name),
            onChange: event => toggleOne(item.id, event.target.checked),
          })),
          h('td', null, h('div', {className: 'kds-cell-name'},
            h('span', {className: 'kds-filename', title: item.name}, item.name),
            item.location === 'local' && badge('idle', 'backup_local_only'))),
          h('td', {className: 'kds-nowrap'}, formatDateTime(item.createdAt, item.id)),
          h('td', {className: 'kds-nowrap'}, formatBytes(item.totalBytes)),
          h('td', null, h('div', {className: 'kds-row'},
            h('button', {
              type: 'button', className: 'kds-link-btn', disabled: blocked,
              onClick: () => restore(item.id, item.name),
            }, t('restore')),
            h('button', {
              type: 'button', className: 'kds-link-btn kds-link-danger', disabled: blocked,
              onClick: () => deleteBackups([item.id], item.name),
            }, t('backup_delete'))))));
        return h('div', {
          className: 'kds-modal-backdrop',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': `${id}-backup-modal-title`,
          onClick: event => { if (event.target === event.currentTarget && !busy) setBackupModalOpen(false); },
        },
          h('div', {className: 'kds-modal'},
            h('div', {className: 'kds-modal-head'},
              h('h3', {id: `${id}-backup-modal-title`}, t('backup_manager_title')),
              h('button', {
                type: 'button', className: 'kds-modal-close', disabled: !!busy,
                'aria-label': t('close'),
                onClick: () => setBackupModalOpen(false),
              }, '×')),
            h('div', {className: 'kds-tabs', role: 'tablist'},
              ...SCOPES.map(scope => h('button', {
                key: scope.id, type: 'button', className: 'kds-tab',
                'aria-pressed': backupCategory === scope.id,
                disabled: !scope.enabled || !!busy,
                title: scope.enabled ? t(`scope_${scope.id}`) : t('badge_reserved'),
                onClick: () => {
                  setBackupCategory(scope.id);
                  setSelectedBackups(new Set());
                  loadBackups(scope.id);
                },
              }, t(`scope_${scope.id}`)))),
            h('div', {className: 'kds-modal-body'},
              h('p', {className: 'kds-note'}, t('backup_note').replace('{retention}', String(saved?.retention ?? 10))),
              backups?.error && h('p', {className: 'kds-error'}, t('backup_remote_failed').replace('{error}',
                backups.error.startsWith('requestFailed|')
                  ? `${t('requestFailed')} (${backups.error.split('|')[1]})`
                  : backups.error)),
              rows.length > 0
                ? h('div', {className: 'kds-table'},
                  h('table', {'aria-label': t('backup_manager_title')},
                    h('thead', null, h('tr', null,
                      h('th', null, h('input', {
                        type: 'checkbox', checked: allSelected, disabled: !!busy,
                        'aria-label': t('backup_select_all'),
                        onChange: event => toggleAll(event.target.checked),
                      })),
                      h('th', null, t('backup_filename')),
                      h('th', null, t('backup_modified')),
                      h('th', null, t('backup_size')),
                      h('th', null, t('backup_actions')))),
                    h('tbody', null, ...rows)))
                : h('p', {className: 'kds-note'}, backups?.error ? t('backup_unavailable') : t('backup_empty'))),
            h('div', {className: 'kds-modal-foot'},
              h('button', {
                type: 'button', disabled: blocked, onClick: createBackupNow,
              }, t('backup_now')),
              h('div', {className: 'kds-row'},
                h('button', {
                  type: 'button', disabled: !!busy || dirty, onClick: () => loadBackups(backupCategory),
                }, t('backup_refresh')),
                h('button', {
                  type: 'button', className: 'kds-danger',
                  disabled: blocked || selectedBackups.size === 0,
                  onClick: () => deleteBackups([...selectedBackups]),
                }, t('backup_delete_selected').replace('{count}', String(selectedBackups.size)))))));
      }

      function syncPage() {
        return h('section', {'aria-label': t('tab_sync')},
          !saved && h('div', {className: 'kds-row'},
            h('p', {className: 'kds-note'}, t(busy ? 'loading' : 'load_failed')),
            !busy && button('load', load, false)),
          !saved && feedback(),
          saved && !configured && h('div', {className: 'kds-row'},
            h('p', {className: 'kds-note'}, t('connection_missing')),
            h('button', {type: 'button', className: 'kds-primary', onClick: () => go('connection')}, t('tab_connection'))),
          saved && pluginCard(),
          reservedCards());
      }

      // ---- render: connection page ----------------------------------
      function input(label, key, attrs = {}) {
        const {wide, ...rest} = attrs;
        return h('label', {className: `kds-field${wide ? ' kds-field-wide' : ''}`, key}, t(label),
          h('input', {
            value: draft[key], disabled: !!busy,
            onChange: event => field(key, event.target.value),
            ...rest,
          }));
      }

      function gitInput(label, key, attrs = {}) {
        const {wide, ...rest} = attrs;
        return h('label', {className: `kds-field${wide ? ' kds-field-wide' : ''}`, key}, t(label),
          h('input', {
            value: draft.git[key], disabled: !!busy,
            onChange: event => gitField(key, event.target.value),
            ...rest,
          }));
      }

      function autoApplyRow(checked, onChange) {
        return h('label', {className: 'kds-check'},
          h('input', {
            type: 'checkbox', checked, disabled: !!busy,
            onChange: event => onChange(event.target.checked),
          }),
          h('span', null, t('auto_apply')));
      }

      function connectionPage() {
        if (!draft) return h('section', null, !busy && button('load', load, false));
        const git = draft.transport === 'git';
        return h('form', {onSubmit: save, 'aria-label': t('connection')},
          h('div', {className: 'kds-row'},
            h('span', {className: 'kds-note'}, t('transport')),
            h('div', {className: 'kds-seg', role: 'group', 'aria-label': t('transport')},
              h('button', {type: 'button', 'aria-pressed': !git, disabled: !!busy, onClick: () => chooseTransport('webdav')}, t('transport_webdav')),
              h('button', {type: 'button', 'aria-pressed': git, disabled: !!busy, onClick: () => chooseTransport('git')}, t('transport_git')))),
          !git && h('div', {className: 'kds-fields'},
            input('webdav_address', 'address', {type: 'text', placeholder: 'https://webdav.example.com/dav'}),
            input('webdav_dir', 'dir', {type: 'text', placeholder: '/dsh-sync'}),
            input('webdav_username', 'username', {autoComplete: 'off'}),
            h('label', {className: 'kds-field'}, t('webdav_password'),
              h('input', {type: 'password', value: draft.password, disabled: !!busy, autoComplete: 'new-password',
                onChange: event => field('password', event.target.value)})),
            !git && h('div', {className: 'kds-field kds-field-narrow'}, t('retention'),
              h('input', {type: 'number', min: 0, max: 50, step: 1, inputMode: 'numeric',
                value: draft.retention, disabled: !!busy,
                onChange: event => field('retention', event.target.value)}))),
          !git && autoApplyRow(draft.autoApply, next => field('autoApply', next)),
          git && h('div', {className: 'kds-fields'},
            gitInput('git_repo', 'repo', {type: 'text', wide: true, placeholder: 'git@github.com:owner/repo.git'}),
            gitInput('git_branch', 'branch', {type: 'text'}),
            h('label', {className: 'kds-field'}, t('git_auth'),
              h('select', {
                value: draft.git.auth, disabled: !!busy,
                onChange: event => gitField('auth', event.target.value),
              },
                h('option', {value: 'ssh'}, t('git_auth_ssh')),
                h('option', {value: 'https'}, t('git_auth_https')))),
            draft.git.auth === 'https' && gitInput('git_username', 'gitUsername', {autoComplete: 'off'}),
            draft.git.auth === 'https' && h('label', {className: 'kds-field'}, t('git_token'),
              h('input', {type: 'password', value: draft.git.token, disabled: !!busy, autoComplete: 'new-password',
                onChange: event => gitField('token', event.target.value)})),
            gitInput('git_author_name', 'authorName'),
            gitInput('git_author_email', 'authorEmail'),
            h('div', {className: 'kds-field kds-field-narrow'}, t('retention'),
              h('input', {type: 'number', min: 0, max: 50, step: 1, inputMode: 'numeric',
                value: draft.retention, disabled: !!busy,
                onChange: event => field('retention', event.target.value)}))),
          git && autoApplyRow(draft.git.autoApply, next => gitField('autoApply', next)),
          feedback(),
          h('div', {className: 'kds-actions'},
            button('save', undefined, !dirty || !!busy, {className: 'kds-primary', type: 'submit'}),
            button('test', () => void run('test', async signal => {
              const value = await request('test', {}, signal);
              if (value?.overview) setOverview(value.overview);
            }, 'tested'), !!busy || dirty || !configured)),
          dirty && h('p', {className: 'kds-note kds-help'}, t('unsaved')));
      }

      // ---- root -----------------------------------------------------
      const summary = configured
        ? t('connection_summary').replace('{transport}', t(saved.transport === 'git' ? 'transport_git' : 'transport_webdav')).replace('{target}', targetLabel(saved))
        : t('connection_missing');
      const [errorKey, errorDetail] = error.startsWith('requestFailed|') ? error.split('|') : [error];

      return h('div', {className: 'kds-sync', 'aria-busy': busy ? 'true' : undefined},
        h('style', null, style),
        h('div', {className: 'kds-topbar'},
          h('h2', null, t('title')),
          h('div', {className: 'kds-tabs', role: 'group', 'aria-label': t('tabs_label')},
            h('button', {type: 'button', className: 'kds-tab', 'aria-pressed': page === 'sync', onClick: () => go('sync')}, t('tab_sync')),
            h('button', {type: 'button', className: 'kds-tab', 'aria-pressed': page === 'connection', onClick: () => go('connection')}, t('tab_connection')))),
        h('div', {className: 'kds-conn-bar'},
          h('div', {className: 'kds-conn-left'},
            h('span', {className: `kds-dot ${configured ? 'kds-dot-ok' : ''}`, 'aria-hidden': true}),
            h('span', {className: 'kds-endpoint'}, configured ? `${t(saved.transport === 'git' ? 'transport_git' : 'transport_webdav')} · ${targetLabel(saved)}` : t('connection_missing')),
            configured && h('span', {className: 'kds-pill'}, `${t('retention')} ${saved?.retention ?? 10}`)),
          configured && button('refresh', load, !!busy || dirty, {className: 'kds-ghost'})),
        page === 'sync' ? syncPage() : connectionPage(),
        backupModal());
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(ns, {en: english, zh: chinese}));
        const t = ctx.locale.bind(ns);
        const Page = () => h(SettingsPage, {locale: ctx.locale, t});
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: ns, order: 70, label: () => t('title'),
        }, Page));
      },
    };
  },
});