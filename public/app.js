const composer = document.querySelector("#composer");
const promptInput = document.querySelector("#promptInput");
const charCount = document.querySelector("#charCount");
const polishButton = document.querySelector("#polishButton");
const generateButton = document.querySelector("#generateButton");
const generateButtonText = document.querySelector("#generateButtonText");
const resultImage = document.querySelector("#resultImage");
const emptyArt = document.querySelector("#emptyArt");
const loadingLayer = document.querySelector("#loadingLayer");
const previewFrame = document.querySelector("#previewFrame");
const downloadButton = document.querySelector("#downloadButton");
const shareButton = document.querySelector("#shareButton");
const copyButton = document.querySelector("#copyButton");
const modelPill = document.querySelector("#modelPill");
const toast = document.querySelector("#toast");
const historySection = document.querySelector("#historySection");
const historyGrid = document.querySelector("#historyGrid");
const clearHistoryButton = document.querySelector("#clearHistoryButton");

const historyKey = "image2-studio-history";
let lastResult = null;
let toastTimer = 0;

const polishPhrases = {
  photo: "真实摄影质感，主体清晰，光影自然，细节丰富，适合移动端竖屏展示",
  poster: "商业海报构图，视觉层级明确，标题区域留白，色彩有记忆点",
  illustration: "精致插画风，形状干净，色彩有对比，画面有叙事感",
  product: "高端产品摄影，材质清楚，轮廓利落，背景干净，有广告质感",
  threeD: "高质量 3D 渲染，柔和全局光，几何干净，空间层次清晰",
  minimal: "极简构图，留白充足，焦点明确，细节克制"
};

init();

function init() {
  updateCount();
  updatePreviewRatio();
  renderHistory();
  loadConfig();

  promptInput.addEventListener("input", updateCount);
  composer.addEventListener("submit", generateImage);
  polishButton.addEventListener("click", polishPrompt);
  downloadButton.addEventListener("click", downloadImage);
  shareButton.addEventListener("click", shareImage);
  copyButton.addEventListener("click", copyPrompt);
  clearHistoryButton.addEventListener("click", clearHistory);

  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      promptInput.value = chip.dataset.prompt || "";
      promptInput.focus();
      updateCount();
    });
  });

  document.querySelectorAll('input[name="size"]').forEach((input) => {
    input.addEventListener("change", updatePreviewRatio);
  });
}

async function loadConfig() {
  try {
    const response = await fetch("/api/config");
    const config = await response.json();
    modelPill.textContent = displayModelName(config.model);
    if (!config.hasApiKey) {
      showToast("先在 .env 中设置 OPENAI_API_KEY");
    }
  } catch {
    modelPill.textContent = "Image 2";
  }
}

async function generateImage(event) {
  event.preventDefault();
  const prompt = promptInput.value.trim();

  if (prompt.length < 4) {
    showToast("提示词再具体一点");
    promptInput.focus();
    return;
  }

  setBusy(true);

  try {
    const payload = {
      prompt,
      style: getCheckedValue("style"),
      size: getCheckedValue("size"),
      quality: getCheckedValue("quality"),
      format: getCheckedValue("format"),
      background: getCheckedValue("background")
    };

    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || "生成失败");
    }

    lastResult = {
      image: data.image,
      prompt: data.prompt || prompt,
      revisedPrompt: data.revisedPrompt || "",
      options: data.options || payload,
      created: data.created || Math.floor(Date.now() / 1000)
    };

    showImage(lastResult.image);
    await saveToHistory(lastResult);
    renderHistory();
    showToast("图片已生成");
  } catch (error) {
    showToast(error.message || "生成失败");
  } finally {
    setBusy(false);
  }
}

function polishPrompt() {
  const style = getCheckedValue("style");
  const phrase = polishPhrases[style] || polishPhrases.photo;
  const current = promptInput.value.trim();

  if (!current) {
    promptInput.value = "一张具有明确主体和情绪氛围的移动端视觉，" + phrase;
  } else if (!current.includes(phrase)) {
    promptInput.value = `${current}，${phrase}`;
  }

  updateCount();
  promptInput.focus();
}

function showImage(src) {
  resultImage.src = src;
  resultImage.hidden = false;
  emptyArt.hidden = true;
  downloadButton.disabled = false;
  shareButton.disabled = false;
  copyButton.disabled = false;
}

function setBusy(isBusy) {
  generateButton.disabled = isBusy;
  generateButton.classList.toggle("is-busy", isBusy);
  generateButtonText.textContent = isBusy ? "生成中" : "生成图片";
  loadingLayer.hidden = !isBusy;
}

function updateCount() {
  charCount.textContent = `${promptInput.value.length}/1200`;
}

function updatePreviewRatio() {
  const size = getCheckedValue("size");
  previewFrame.classList.toggle("square", size === "1024x1024");
  previewFrame.classList.toggle("landscape", size === "1536x1024");
}

function downloadImage() {
  if (!lastResult) {
    return;
  }

  const extension = (lastResult.options && lastResult.options.outputFormat) || getCheckedValue("format");
  const link = document.createElement("a");
  link.href = lastResult.image;
  link.download = `image-2-${Date.now()}.${extension}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function shareImage() {
  if (!lastResult) {
    return;
  }

  try {
    if (navigator.share && navigator.canShare) {
      const blob = await (await fetch(lastResult.image)).blob();
      const file = new File([blob], "image-2-result.png", { type: blob.type || "image/png" });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "Image 2 Studio" });
        return;
      }
    }

    await navigator.clipboard.writeText(lastResult.image);
    showToast("图片数据已复制");
  } catch {
    showToast("当前浏览器不支持分享");
  }
}

async function copyPrompt() {
  if (!lastResult) {
    return;
  }

  try {
    await navigator.clipboard.writeText(lastResult.prompt);
    showToast("提示词已复制");
  } catch {
    showToast("复制失败");
  }
}

async function saveToHistory(result) {
  const history = readHistory();
  const thumb = await createThumb(result.image);
  history.unshift({
    id: String(Date.now()),
    thumb,
    image: result.image.length < 900000 ? result.image : thumb,
    prompt: result.prompt,
    created: result.created
  });

  writeHistory(history.slice(0, 9));
}

function renderHistory() {
  const history = readHistory();
  historySection.hidden = history.length === 0;
  historyGrid.innerHTML = "";

  history.forEach((item) => {
    const wrapper = document.createElement("div");
    wrapper.className = "history-item";

    const image = document.createElement("img");
    image.src = item.thumb;
    image.alt = item.prompt || "历史作品";

    const button = document.createElement("button");
    button.type = "button";
    button.title = "打开历史作品";
    button.addEventListener("click", () => {
      lastResult = {
        image: item.image || item.thumb,
        prompt: item.prompt || "",
        options: { outputFormat: "png" },
        created: item.created
      };
      showImage(lastResult.image);
      promptInput.value = lastResult.prompt;
      updateCount();
      showToast("已打开历史作品");
    });

    wrapper.append(image, button);
    historyGrid.append(wrapper);
  });
}

function clearHistory() {
  localStorage.removeItem(historyKey);
  renderHistory();
  showToast("历史已清空");
}

function readHistory() {
  try {
    return JSON.parse(localStorage.getItem(historyKey) || "[]");
  } catch {
    return [];
  }
}

function writeHistory(history) {
  try {
    localStorage.setItem(historyKey, JSON.stringify(history));
  } catch {
    localStorage.setItem(historyKey, JSON.stringify(history.slice(0, 3)));
  }
}

function createThumb(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const size = 420;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      const scale = Math.max(size / img.width, size / img.height);
      const width = img.width * scale;
      const height = img.height * scale;
      const x = (size - width) / 2;
      const y = (size - height) / 2;
      ctx.drawImage(img, x, y, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.74));
    };
    img.onerror = () => resolve(src);
    img.src = src;
  });
}

function getCheckedValue(name) {
  const checked = document.querySelector(`input[name="${name}"]:checked`);
  return checked ? checked.value : "";
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("show");
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2600);
}

function displayModelName(model) {
  if (!model) {
    return "Image 2";
  }

  const compact = model.replace(/^gpt-/, "").replace(/-/g, " ");
  return compact.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}
