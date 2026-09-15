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
    
    // 🔥 'auto' ki jagah 'Autodetect' lagaya hai
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=Autodetect|${lang}`;
    
    try {
      const res = await fetch(url);
      const data = await res.json();
      
      // 🔥 Agar API ne koi error diya, toh UI par kachra print hone se rokega
      if (data.responseStatus !== 200) {
        console.error('[whispr] API Error:', data.responseData.translatedText);
        return "⚠️ Translation API error!";
      }
      
      return data?.responseData?.translatedText || null;
    } catch (err) {
      console.error('[whispr] translation failed:', err);
      return null;
    }
  }

  window.Whispr = window.Whispr || {};
  Object.assign(window.Whispr, { getTargetLang, setTargetLang, translateText });
})();
