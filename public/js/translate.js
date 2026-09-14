(function () {
  const LANG_KEY = 'whispr-translate-lang'; // UI preference only

  function getTargetLang() {
    return localStorage.getItem(LANG_KEY) || 'en';
  }
  function setTargetLang(lang) {
    localStorage.setItem(LANG_KEY, lang);
  }

  async function translateText(text, targetLang) {
    const lang = targetLang || getTargetLang();
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=auto|${lang}`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      return data?.responseData?.translatedText || null;
    } catch (err) {
      console.error('[whispr] translation failed:', err);
      return null;
    }
  }

  window.Whispr = window.Whispr || {};
  Object.assign(window.Whispr, { getTargetLang, setTargetLang, translateText });
})();
