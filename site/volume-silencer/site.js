const tabs = document.querySelectorAll(".demo-tabs [data-platform]");
const browser = document.getElementById("demoBrowser");
const platformName = document.getElementById("demoPlatformName");
const platformLogo = document.getElementById("demoPlatformLogo");
const videoTitle = document.getElementById("demoVideoTitle");
const searchLabel = document.getElementById("demoSearchLabel");
const channelName = document.getElementById("demoChannelName");
const channelMeta = document.getElementById("demoChannelMeta");
const followLabel = document.getElementById("demoFollowLabel");
const likeCount = document.getElementById("demoLikeCount");
const volumeValue = document.getElementById("demoVolumeValue");
const toastValue = document.getElementById("demoToastValue");
const viewerAvatar = document.getElementById("demoViewerAvatar");
const channelAvatar = document.getElementById("demoChannelAvatar");
const slider = document.querySelector(".demo-slider");
const modeButtons = [...document.querySelectorAll("[data-demo-mode]")];
const presetButtons = [...document.querySelectorAll("[data-demo-preset]")];
const navLabels = ["demoNavOne", "demoNavTwo", "demoNavThree", "demoNavFour"].map((id) => document.getElementById(id));
const canvas = document.getElementById("demoVideo");
const context = canvas?.getContext("2d");

const platformCopy = {
  youtube: { name: "YouTube", logo: "assets/youtube.svg", search: "Search", title: "Building a midnight synth in 90 seconds", channel: "Night Signal Studio", meta: "184K subscribers", follow: "Subscribe", likes: "12K", nav: ["Home", "Shorts", "Subscriptions", "You"], volume: "0.70%", mode: "stealth", slider: 70, presets: ["0", ".25", ".50", ".75", "1"], activePreset: 3 },
  instagram: { name: "Instagram", logo: "assets/instagram.svg", search: "Search", title: "The patch finally sounds alive", channel: "kyrt.codes", meta: "Original audio", follow: "Follow", likes: "18.4K", nav: ["Home", "Reels", "Explore", "Profile"], viewerAvatar: "assets/jojo-profile.png", channelAvatar: "assets/kyrt-profile.png", volume: "68%", mode: "normal", slider: 68, presets: ["0", "25", "50", "75", "100"], activePreset: 3 },
  tiktok: { name: "TikTok", logo: "assets/tiktok.svg", search: "Search accounts and videos", title: "POV: the bassline starts behaving", channel: "@night.signal", meta: "♫ original sound", follow: "Follow", likes: "42K", nav: ["For You", "Explore", "Following", "Profile"], volume: "300%", mode: "blunt", slider: 50, presets: ["100", "200", "300", "400", "500"], activePreset: 2 }
};

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const platform = tab.dataset.platform;
    tabs.forEach((candidate) => {
      const active = candidate === tab;
      candidate.classList.toggle("is-active", active);
      candidate.setAttribute("aria-selected", String(active));
    });
    browser.dataset.platform = platform;
    const copy = platformCopy[platform];
    platformName.querySelector("span").textContent = copy.name;
    platformLogo.src = copy.logo;
    searchLabel.textContent = copy.search;
    videoTitle.textContent = copy.title;
    channelName.textContent = copy.channel;
    channelMeta.textContent = copy.meta;
    followLabel.textContent = copy.follow;
    likeCount.textContent = copy.likes;
    navLabels.forEach((label, index) => { label.textContent = copy.nav[index]; });
    volumeValue.textContent = copy.volume;
    toastValue.textContent = copy.volume;
    slider.style.setProperty("--demo-level", `${copy.slider}%`);
    modeButtons.forEach((button) => button.classList.toggle("active", button.dataset.demoMode === copy.mode));
    presetButtons.forEach((button, index) => {
      button.textContent = copy.presets[index];
      button.classList.toggle("active", index === copy.activePreset);
    });
    [[viewerAvatar, copy.viewerAvatar], [channelAvatar, copy.channelAvatar]].forEach(([image, source]) => {
      image.hidden = !source;
      if (source) image.src = source;
    });
    resizeCanvas();
  });
});

let animationFrame = 0;

function resizeCanvas() {
  if (!canvas || !context) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width * ratio));
  canvas.height = Math.max(1, Math.round(rect.height * ratio));
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function drawVideo(time) {
  if (!canvas || !context) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const horizon = height * 0.46;
  context.clearRect(0, 0, width, height);

  const sky = context.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#111826");
  sky.addColorStop(0.55, "#272039");
  sky.addColorStop(1, "#08090b");
  context.fillStyle = sky;
  context.fillRect(0, 0, width, height);

  context.fillStyle = "rgba(255,246,210,.88)";
  context.beginPath();
  context.arc(width * 0.77, height * 0.19, Math.max(8, width * 0.025), 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "#0b0e15";
  for (let x = -10; x < width; x += Math.max(18, width * 0.055)) {
    const buildingHeight = 15 + ((x * 7) % 33 + 33) % 33;
    context.fillRect(x, horizon - buildingHeight, Math.max(14, width * 0.045), buildingHeight);
  }

  context.fillStyle = "#090a0d";
  context.beginPath();
  context.moveTo(width * 0.35, horizon);
  context.lineTo(width * 0.65, horizon);
  context.lineTo(width * 0.94, height);
  context.lineTo(width * 0.06, height);
  context.closePath();
  context.fill();

  const movement = (time * 0.08) % 36;
  context.fillStyle = "rgba(239,228,188,.76)";
  for (let y = horizon + movement; y < height; y += 36) {
    const progress = (y - horizon) / Math.max(height - horizon, 1);
    const dashWidth = 2 + progress * 6;
    context.fillRect(width / 2 - dashWidth / 2, y, dashWidth, 8 + progress * 13);
  }

  context.strokeStyle = "rgba(103,186,214,.56)";
  context.lineWidth = 1.5;
  context.beginPath();
  for (let x = 0; x <= width; x += 5) {
    const y = height * 0.27 + Math.sin(x * 0.08 + time * 0.004) * 5;
    if (x === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
  animationFrame = requestAnimationFrame(drawVideo);
}

if (canvas && context) {
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas, { passive: true });
  animationFrame = requestAnimationFrame(drawVideo);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelAnimationFrame(animationFrame);
    else animationFrame = requestAnimationFrame(drawVideo);
  });
}
