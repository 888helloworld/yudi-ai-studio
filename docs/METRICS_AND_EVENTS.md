# 指标和埋点框架

## 指标树

北极星指标：7 日有效创作内容数。

一级拆解：

- 活跃创作者数
- 人均创作次数
- 创作成功率
- 积分可用率
- 生成后复用率

## 核心业务指标

| 指标 | 口径 |
|---|---|
| 注册成功率 | 注册成功数 / 注册提交数 |
| 首创成功率 | 注册后 24 小时内完成有效创作用户数 / 注册成功用户数 |
| 图片成功率 | 图片生成成功数 / 图片生成提交数 |
| 文案成功率 | 文案生成成功数 / 文案生成提交数 |
| 图文成功率 | 图文一体至少一项成功数 / 图文一体提交数 |
| 积分消耗 | 成功创作扣除积分总数 |
| 退款积分 | 生成失败返还积分总数 |
| 充值转化率 | 支付成功用户数 / 点击充值用户数 |
| 卡密兑换率 | 兑换成功数 / 卡密输入提交数 |

## 推荐事件

| 事件名 | 触发时机 | 关键属性 |
|---|---|---|
| page_view | 页面打开 | page, user_id, role |
| signup_submit | 提交注册 | invite_code_present |
| signup_success | 注册成功 | user_id, invite_points |
| login_success | 登录成功 | user_id, role |
| create_submit | 点击生成 | create_type, ratio, has_reference |
| create_success | 生成成功 | create_type, cost_points, duration_ms |
| create_failed | 生成失败 | create_type, error_code, refunded_points |
| history_open | 打开历史详情 | history_id, type |
| history_delete | 删除历史 | history_id, type |
| cdkey_redeem_submit | 提交卡密 | code_length |
| cdkey_redeem_success | 兑换成功 | points |
| payment_create | 创建订单 | points, amount, channel |
| payment_success | 支付成功 | order_no, points, amount |

## 管理后台看板

第一屏：

- 今日新增用户
- 今日有效创作数
- 今日消耗积分
- 今日充值金额
- 生成成功率

运营页：

- 用户排行榜：创作次数、积分消耗、最近活跃时间。
- 功能分布：图片、文案、改写、图文一体占比。
- 失败分析：接口失败、积分不足、内容不合规、超时。

## 数据治理

- 事件只记录必要字段，不记录明文密码、完整 token、API Key。
- 用户输入可记录摘要和长度，敏感文本应脱敏。
- 支付回调必须以平台验签结果为准，不能以前端轮询结果为准。
