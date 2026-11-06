(() => {
  if (globalThis.__spotCleanerContentInstalled) return;
  globalThis.__spotCleanerContentInstalled = true;

  const extract = () => {
    const title = document.querySelector("header h1,h1")?.textContent?.trim() || document.title || "دوره بدون عنوان";
    const description = document.querySelector("header p")?.textContent?.trim() || "";
    const lessons = [...document.querySelectorAll("#vids li.vid a,li.vid a")]
      .map((a, i) => {
        try {
          const u = new URL(a.href, location.href);
          const name = u.pathname.split("/").filter(Boolean).pop() || "";
          const match = name.match(/^([a-f0-9]{24})\.spot$/i);
          if (!match) return null;
          return {
            index: i + 1,
            title: (a.textContent || "").trim() || `درس ${i + 1}`,
            id: match[1].toLowerCase(),
            url: u.href,
            pathIds: u.pathname.split("/").filter(Boolean).slice(0, -1)
          };
        } catch (_) { return null; }
      }).filter(Boolean);
    return {
      pageUrl: location.href,
      courseTitle: title,
      description,
      lessons,
      extractedAt: new Date().toISOString()
    };
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "SPOT_CLEANER_EXTRACT") {
      sendResponse({ ok: true, ...extract() });
    }
  });
})();
