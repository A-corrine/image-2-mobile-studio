const loginForm = document.querySelector("#adminLoginForm");
const passwordInput = document.querySelector("#adminPasswordInput");
const loginStatus = document.querySelector("#adminLoginStatus");
const dashboard = document.querySelector("#adminDashboard");
const metricGrid = document.querySelector("#metricGrid");
const revenueTableBody = document.querySelector("#revenueTableBody");
const paymentTableBody = document.querySelector("#paymentTableBody");
const updatedAt = document.querySelector("#adminUpdatedAt");
const refreshButton = document.querySelector("#refreshAdminButton");
const logoutButton = document.querySelector("#adminLogoutButton");

let authorization = "";

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authorization = `Basic ${base64Utf8(`admin:${passwordInput.value}`)}`;
  passwordInput.value = "";
  await loadSummary();
});

refreshButton.addEventListener("click", loadSummary);
logoutButton.addEventListener("click", () => {
  authorization = "";
  dashboard.hidden = true;
  loginForm.hidden = false;
  refreshButton.hidden = true;
  logoutButton.hidden = true;
  loginStatus.textContent = "";
  passwordInput.focus();
});

async function loadSummary() {
  loginStatus.textContent = "正在读取...";
  try {
    const response = await fetch("/api/admin/summary", {
      headers: { Authorization: authorization },
      cache: "no-store"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "无法读取运营数据");
    }
    renderSummary(data);
    loginForm.hidden = true;
    dashboard.hidden = false;
    refreshButton.hidden = false;
    logoutButton.hidden = false;
    loginStatus.textContent = "";
  } catch (error) {
    authorization = "";
    loginStatus.textContent = error.message || "登录失败";
    loginForm.hidden = false;
    dashboard.hidden = true;
  }
}

function renderSummary(data) {
  const accounts = data.accounts || {};
  const usage = data.usage || {};
  const metrics = [
    ["账户总数", accounts.total_accounts || 0],
    ["已验证邮箱", accounts.verified_accounts || 0],
    ["未使用点数", accounts.outstanding_credits || 0],
    ["生成请求", usage.generation_requests || 0],
    ["失败退点", usage.failed_generations || 0]
  ];
  metricGrid.innerHTML = "";
  metrics.forEach(([label, value]) => {
    const item = document.createElement("div");
    item.className = "metric-item";
    const number = document.createElement("strong");
    number.textContent = String(value);
    const name = document.createElement("span");
    name.textContent = label;
    item.append(number, name);
    metricGrid.append(item);
  });

  revenueTableBody.innerHTML = "";
  const revenue = data.revenue || [];
  if (!revenue.length) {
    revenueTableBody.append(emptyRow(3, "暂无付款"));
  } else {
    revenue.forEach((item) => {
      const row = document.createElement("tr");
      appendCells(row, [item.currency.toUpperCase(), item.payments, formatMoney(item.net_amount, item.currency)]);
      revenueTableBody.append(row);
    });
  }

  paymentTableBody.innerHTML = "";
  const payments = data.recentPayments || [];
  if (!payments.length) {
    paymentTableBody.append(emptyRow(6, "暂无订单"));
  } else {
    payments.forEach((payment) => {
      const row = document.createElement("tr");
      appendCells(row, [
        new Date(payment.created_at).toLocaleString("zh-CN"),
        payment.email || "未验证",
        formatMoney(payment.amount_total - payment.refunded_amount, payment.currency),
        payment.credits,
        statusLabel(payment.status),
        `…${payment.session_id.slice(-10)}`
      ]);
      paymentTableBody.append(row);
    });
  }

  updatedAt.textContent = `更新于 ${new Date(data.generatedAt).toLocaleString("zh-CN")}`;
}

function appendCells(row, values) {
  values.forEach((value) => {
    const cell = document.createElement("td");
    cell.textContent = String(value);
    row.append(cell);
  });
}

function emptyRow(columns, message) {
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = columns;
  cell.textContent = message;
  cell.className = "empty-table";
  row.append(cell);
  return row;
}

function formatMoney(amount, currency) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: String(currency || "cny").toUpperCase()
  }).format(Number(amount || 0) / 100);
}

function statusLabel(status) {
  return {
    paid: "已付款",
    partially_refunded: "部分退款",
    refunded: "已退款"
  }[status] || status;
}

function base64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}
