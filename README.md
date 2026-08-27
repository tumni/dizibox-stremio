# 📺 Dizibox Stremio Addon

> **Geliştiren:** [@tumni](https://github.com/tumni)

Bu eklenti tamamen sıfırdan yazılarak [dizibox.now](https://dizibox.now) üzerindeki **Türkçe altyazılı** yabancı dizileri (ve filmleri) Stremio'da sorunsuzca izleyebilmeniz için geliştirildi. 

Site içerisindeki karmaşık video korumaları, proxy (vekil sunucu) mimarisi ile aşıldı! 🚀

---

## ✨ Özellikler

- 📺 **Geniş Arşiv:** Dizibox'taki tüm Türkçe altyazılı diziler
- 🗂️ **Keşfet Kataloğu:** Stremio Keşfet sayfasında 20+ kategori (Aksiyon, Korku, Komedi, Bilim Kurgu vb.)
- 🎬 **Otomatik Eşleştirme:** Dizilerin sezon ve bölüm bilgileriyle tam uyumlu
- 🛡️ **Gelişmiş Proxy Sistemi:** 403 Forbidden hatalarını aşan, arka planda chunk (.ts) bazlı çalışan özel proxy motoru.
- 📝 **Altyazı Desteği:** Videolara gömülü Türkçe altyazıların otomatik algılanması

---

## 🚀 Kurulum (Render.com - Ücretsiz)

Projeyi tamamen ücretsiz bir şekilde [Render.com](https://render.com) üzerinde barındırabilirsiniz.

1. [Render.com](https://render.com) adresine gidin ve GitHub hesabınızla giriş yapın.
2. Sağ üstten **New+** butonuna tıklayıp **Web Service** seçin.
3. Bu repoyu (`tumni/dizibox-stremio`) seçin.
4. Ayarları aşağıdaki gibi yapın:
   - **Name:** `dizibox-stremio` (veya istediğiniz bir ad)
   - **Region:** Frankfurt (EU)
   - **Branch:** `main`
   - **Build Command:** `npm install`
   - **Start Command:** `node addon.js`
   - **Instance Type:** `Free`
5. **Environment Variables** (Ortam Değişkenleri) bölümüne ekleyin:
   - `BASE_URL` = `https://sizin-render-urlniz.onrender.com` (Uygulama oluştuktan sonra URL'yi kopyalayıp buraya yapıştırın ve kaydedin)
6. **Deploy** butonuna basın.

Uygulama ayağa kalktığında, Render'ın size verdiği URL'nin sonuna `/manifest.json` ekleyerek Stremio'ya kurabilirsiniz:
```
https://sizin-render-urlniz.onrender.com/manifest.json
```

---

## 💻 Geliştiriciler İçin (Local Kurulum)

Projeyi bilgisayarınızda çalıştırmak isterseniz:

```bash
git clone https://github.com/tumni/dizibox-stremio.git
cd dizibox-stremio
npm install
npm start
```
Stremio eklenti arama çubuğuna şunu yapıştırın: `http://localhost:7000/manifest.json`

---

## 🏗️ Proje Mimarisi
*Bu eklenti standart scraperlardan farklı olarak **stream proxy** mekanizması içerir.*
- `addon.js`: Ana Stremio sunucusu ve Proxy uç noktaları (`/proxy/m3u8` & `/proxy/stream`)
- `search.js`: Cinemeta API'si ile IMDb ID'leri eşleştirip Dizibox üzerinde akıllı arama yapar
- `scraper.js`: Sayfa içi iframe'leri ayrıştırıp, ksdpictures vs. sunuculardan `var SOURCE` ve `var TRACKS` verilerini çeker
- `catalog.js`: Stremio Keşfet ekranı için Cinemeta üzerinden proxy katalog oluşturur

## ⚠️ Sorumluluk Reddi
Bu proje yalnızca eğitim amaçlıdır. İçeriklerin telif hakları ilgili sahiplerine aittir, hiçbir video dosyası bu sunucuda barındırılmamaktadır.

## 📜 Lisans
MIT
