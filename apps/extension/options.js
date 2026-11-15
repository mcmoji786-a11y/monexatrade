const input = document.getElementById("site");
const saved = document.getElementById("saved");
chrome.storage.sync.get({ site: "https://kixo.trade" }, (v) => (input.value = v.site));
document.getElementById("save").addEventListener("click", () => {
  let site = input.value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s]+$/.test(site)) site = "https://kixo.trade";
  chrome.storage.sync.set({ site }, () => {
    input.value = site;
    saved.textContent = "Saved";
    setTimeout(() => (saved.textContent = ""), 1500);
  });
});
