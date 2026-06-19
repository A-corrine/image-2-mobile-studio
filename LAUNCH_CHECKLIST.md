# Image 2 Studio 收款上线清单

以下项目必须按顺序完成。任何一项未通过，都保持 `BILLING_ENABLED=false`。

## 1. 准备经营信息

- 确定对外展示的产品或经营者名称。
- 准备真实可用的客服邮箱。
- 阅读并按实际经营主体、地区和业务修改：
  - `public/terms.html`
  - `public/privacy.html`
  - `public/refund.html`
- 如无法确认当地消费者、隐私或税务要求，正式收款前咨询专业人士。

Render 环境变量：

```text
BUSINESS_NAME=你的产品或经营者名称
SUPPORT_EMAIL=真实客服邮箱
```

## 2. 配置持久数据

Render 免费实例的文件会丢失，不能保存真钱余额。

1. 把 Render 服务升级到支持 Persistent Disk 的实例。
2. 添加 1 GB 磁盘。
3. Mount path 填：`/opt/render/project/src/data`
4. 保持：`DATABASE_PATH=./data/app.db`
5. 重新部署后确认服务正常。

## 3. 配置邮箱登录

1. 注册 Resend。
2. 验证用于发信的域名。
3. 创建 API Key。
4. 在 Render 添加：

```text
RESEND_API_KEY=re_开头的密钥
EMAIL_FROM=Image 2 Studio <login@你的已验证域名>
```

5. 保持 `BILLING_ENABLED=false`，重新部署。
6. 用真实邮箱测试：发送验证码、登录、退出、另一浏览器登录、余额恢复。

## 4. 配置测试支付

只有具备可用的 Stripe 商户账户时才继续；否则需要替换支付服务商，不能直接开启收款。

1. 使用 Stripe 测试模式密钥：

```text
STRIPE_SECRET_KEY=sk_test_开头的密钥
```

2. 在 Stripe 创建 Webhook Endpoint：

```text
https://你的正式域名/api/stripe/webhook
```

3. 只订阅：`checkout.session.completed`
4. 把 Endpoint 的 Signing secret 填入 Render：

```text
STRIPE_WEBHOOK_SECRET=whsec_开头的密钥
```

5. 暂时设置 `BILLING_ENABLED=true`，重新部署并完成测试订单。
6. 验证支付后点数只增加一次；在 Stripe 重发同一事件，余额不得再次增加。
7. 测试完成后先改回 `BILLING_ENABLED=false`。

## 5. 核对成本与售价

当前点数包：

- ¥9.90 / 10 次
- ¥29.90 / 50 次
- ¥59.90 / 120 次

在正式销售前，按实际生图 API 单次成本、失败率、支付手续费、退款、税费和客服成本计算毛利。售价必须覆盖最坏情况下的实际成本，不要只按接口标价估算。

## 6. 生产发布

1. 在 Stripe 切换到生产模式并替换生产密钥。
2. 创建生产 Webhook，重新填写对应的 `whsec_`。
3. 完成一笔真实小额订单。
4. 核对订单金额、点数到账、生成扣点、失败退点、客服邮箱和政策页面。
5. 确认数据库位于持久磁盘并完成备份方案。
6. 最后设置：

```text
BILLING_ENABLED=true
```

## 7. 每周检查

- Stripe 付款失败、退款和争议。
- Render 错误日志、磁盘容量和服务可用性。
- AI 接口余额、单次成本和异常请求。
- 客服邮箱、账户合并和点数未到账问题。
- 根据真实成本调整点数包，改价后再次走完整测试订单。
