# 指标和埋点框架

这份文档讲怎么衡量“御弟哥哥”有没有真的帮用户创作，而不是只看页面好不好看。

## 北极星指标

**7 日有效创作内容数。**

有效创作包括：

- `gpt-image-2` 文生图成功。
- `gpt-image-2` 参考图改图成功。
- 看图写 Prompt 成功。
- 小红书图片生成成功。
- 文案生成或改写成功。
- 图文一体至少有一项成功。

## 指标树

一级拆解：

- 活跃创作者数
- 人均创作次数
- 创作成功率
- 失败退款正确率
- 生成后复用率
- 历史记录使用率
- 积分消耗和充值转化

## 核心业务指标

| 指标 | 口径 |
| --- | --- |
| 注册成功率 | 注册成功数 / 注册提交数 |
| 邀请码依赖率 | 使用邀请码注册数 / 注册成功数 |
| 本地免邀请码注册数 | `inviteRequired=false` 时的注册成功数 |
| 首创成功率 | 注册后 24 小时内完成有效创作用户数 / 注册成功用户数 |
| 图片成功率 | 图片生成成功任务数 / 图片生成提交任务数 |
| 改图成功率 | 改图成功任务数 / 改图提交任务数 |
| 看图写 Prompt 成功率 | 成功返回 Prompt 数 / 提交数 |
| 任务平均耗时 | 成功任务 `duration_ms` 平均值 |
| 尺寸不匹配率 | 输出尺寸不等于请求尺寸的图片数 / 成功图片数 |
| 失败退款率 | 已退款失败任务数 / 失败任务数 |
| 少出图退款率 | 少出图且退款任务数 / 少出图任务数 |
| 积分消耗 | 成功创作扣除积分总数 |
| 退款积分 | 失败或少出图返还积分总数 |
| 卡密兑换率 | 兑换成功数 / 卡密输入提交数 |
| 充值转化率 | 支付成功用户数 / 点击充值用户数 |

## 推荐事件

| 事件名 | 触发时机 | 关键属性 |
| --- | --- | --- |
| `page_view` | 页面打开 | `page`, `user_id`, `role` |
| `signup_config_loaded` | 注册页读取配置 | `invite_required`, `host_type` |
| `signup_submit` | 提交注册 | `invite_code_present` |
| `signup_success` | 注册成功 | `user_id`, `invite_used`, `bonus_points` |
| `login_success` | 登录成功 | `user_id`, `role` |
| `image_job_submit` | 画面工坊提交任务 | `mode`, `size`, `display_size`, `quality`, `count`, `has_reference`, `source_count` |
| `image_job_queued` | 服务端创建任务 | `job_id`, `history_id`, `size`, `quality`, `cost_points` |
| `image_job_started` | 任务开始跑 | `job_id`, `queue_wait_ms` |
| `image_job_success` | 任务成功 | `job_id`, `history_id`, `duration_ms`, `output_count`, `output_dimensions`, `cost_points` |
| `image_job_failed` | 任务失败 | `job_id`, `error_type`, `refunded_points` |
| `image_size_mismatch` | 输出尺寸不等于请求尺寸 | `requested_size`, `actual_size`, `provider`, `history_id` |
| `reverse_prompt_submit` | 提交看图写 Prompt | `reverse_mode`, `image_size`, `image_bytes` |
| `reverse_prompt_success` | 成功反推 | `duration_ms`, `model`, `history_id` |
| `history_open` | 打开历史详情 | `history_id`, `type`, `sub_type` |
| `history_reuse_prompt` | 复用提示词 | `history_id`, `target_page` |
| `history_reuse_image` | 历史图作为参考图 | `history_id`, `source_count` |
| `download_image` | 下载图片 | `history_id`, `image_index`, `actual_size` |
| `cdkey_redeem_submit` | 提交卡密 | `code_length` |
| `cdkey_redeem_success` | 兑换成功 | `points` |
| `payment_create` | 创建订单 | `points`, `amount`, `channel` |
| `payment_success` | 支付成功 | `order_no`, `points`, `amount` |

## 管理后台看板

第一屏建议看：

- 今日新增用户
- 今日有效创作数
- 今日成功图片数
- 今日失败任务数
- 今日退款积分
- 今日消耗积分
- 今日充值金额
- 图片成功率

画面工坊专项：

- 按请求尺寸统计：`1024x1024`、`1024x1536`、`1536x1024`、`2048x1152`、`1152x2048`
- 按真实输出尺寸统计：从 `output_dimensions` 读取，不写死历史观测值
- 按质量统计：快速、标准、精细
- 平均耗时
- 排队数和运行数
- 尺寸不匹配次数
- 上游错误 Top 10
- 用户重试次数

运营页：

- 用户排行榜：创作次数、积分消耗、最近活跃时间。
- 功能分布：画面工坊、小红书图片、文案、改写、图文一体、看图写 Prompt。
- 失败分析：上游失败、超时、积分不足、上传失败、无效尺寸、内容风险。
- 退款分析：失败退款、少出图退款、重启遗留任务退款。

## 数据治理

- 不记录明文密码。
- 不记录完整 JWT。
- 不记录 API Key。
- 不记录支付密钥。
- 用户输入可以记录长度、摘要和类型；敏感文本应脱敏。
- 图片 URL 可以记录业务路径，但隐私图建议走鉴权或签名 URL。
- 支付结果必须以后端验签为准，不能以前端轮询为准。
- 对外展示统计时，不暴露单个用户的私密 Prompt 和上传图。
