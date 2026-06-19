async function loadLegalConfig() {
  try {
    const response = await fetch("/api/config", { cache: "no-store" });
    const config = await response.json();
    document.querySelectorAll("[data-business-name]").forEach((element) => {
      element.textContent = config.businessName || "Image 2 Studio";
    });
    document.querySelectorAll("[data-support-email]").forEach((element) => {
      if (config.supportEmail) {
        element.textContent = config.supportEmail;
        element.href = `mailto:${config.supportEmail}`;
      } else {
        element.textContent = "客服邮箱尚未配置";
        element.removeAttribute("href");
      }
    });
  } catch {
    // Static legal copy remains available if configuration is temporarily unavailable.
  }
}

loadLegalConfig();
