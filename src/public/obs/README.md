# 🏐 OBS Canlı Yayın Kısayol Eklentisi (Scoreboard Hotkeys)

Bu eklenti, OBS Studio canlı yayını yaparken tarayıcıya veya telefona gitmeden, doğrudan klavye kısayollarınızla (NumPad, F tuşları, Stream Deck vb.) voleybol skorboardunu yönetmenizi sağlar.

---

## 🚀 Hızlı Kurulum (1 Dakika)

### 1. Eklentiyi OBS'e Ekleyin
1. **OBS Studio**'yu açın.
2. Üst menüden **Araçlar (Tools)** &rarr; **Komut Dosyaları (Scripts)** seçeneğine tıklayın.
3. Açılan pencerede **`+` (Ekle)** butonuna tıklayın.
4. Bu klasördeki **`scoreboard_hotkeys.lua`** dosyasını seçin. *(OBS'te Lua yerleşik geldiğinden herhangi bir ek kurulum gerekmez!)*

### 2. Skorboard Bilgilerinizi Girin
1. Komut Dosyaları penceresinde `scoreboard_hotkeys.lua` seçili iken sağ tarafta ayarlar görünecektir:
   - **🌐 Sunucu Adresi:** `http://localhost:3000` *(Veya sunucunuzun canlı adresi, örn: `https://skor.domain.com`)*
   - **🔑 Skorboard Kodu / ID:** `fenerbahce` *(veya yönettiğiniz skorboardun 4 haneli kodu)*
2. **⚡ Test Et** butonuna basarak skoru artırabildiğinizi doğrulayın.

### 3. Kısayol Tuşlarını Tanımlayın
1. OBS menüsünden **Dosya** &rarr; **Ayarlar (Settings)** &rarr; **Kısayollar (Hotkeys)** sekmesine gidin.
2. Arama kutusuna `[Skorboard]` yazın.
3. İstediğiniz aksiyonlara klavyenizden tuş atayın:

| Kısayol Adı | Önerilen Tuş | Açıklama |
|---|---|---|
| `[Skorboard] Takım A: +1 Sayı` | **NumPad 1** | Ev Sahibi puana +1 ekler, servisi A'ya geçirir |
| `[Skorboard] Takım A: -1 Sayı (Geri Al)` | **Ctrl + NumPad 1** | Sehven eklenen puanı düzeltir |
| `[Skorboard] Takım B: +1 Sayı` | **NumPad 2** | Deplasman puana +1 ekler, servisi B'ye geçirir |
| `[Skorboard] Takım B: -1 Sayı (Geri Al)` | **Ctrl + NumPad 2** | Sehven eklenen puanı düzeltir |
| `[Skorboard] Servis Değiştir (Sıradaki)` | **NumPad 0** | Servisi diğer takıma devreder |
| `[Skorboard] Takım A: Mola (Aç / Kapat)` | **NumPad 4** | 30 saniyelik mola sayacını başlatır veya durdurur |
| `[Skorboard] Takım B: Mola (Aç / Kapat)` | **NumPad 5** | 30 saniyelik mola sayacını başlatır veya durdurur |
| `[Skorboard] Molayı Bitir` | **NumPad 6** | Devam eden molayı anında kapatır |
| `[Skorboard] Son İşlemi Geri Al (Undo)` | **Ctrl + Z** | Son skoru veya hareketi geri alır |
| `[Skorboard] Saha Değiştir` | **NumPad 9** | Ekranda takımların sağ-sol yerleşimini takas eder |
| `[Skorboard] Süre Başlat / Durdur` | **NumPad Enter** | Set süresi sayacını duraklatır veya başlatır |
| `[Skorboard] Seti Bitir` | *(İsteğe bağlı)* | Mevcut seti tamamlar |

> 💡 **İpucu:** OBS Ayarları &rarr; Gelişmiş sekmesinde *"Kısayol Tuşları Odak Davranışı"* ayarını *"Asla kısayolları devre dışı bırakma"* seçerseniz, başka bir oyunda veya penceredeyken bile tuşlara bastığınızda skor güncellenir!

---

## 🌐 Harici Cihazlar & Stream Deck / Touch Portal Entegrasyonu

Eğer Elgato Stream Deck veya Touch Portal kullanıyorsanız, HTTP GET veya POST istekleri ile doğrudan komut gönderebilirsiniz:

- `GET http://localhost:3000/api/board/KOD/action/point_a`
- `GET http://localhost:3000/api/board/KOD/action/point_b`
- `GET http://localhost:3000/api/board/KOD/action/toggle_serve`
- `GET http://localhost:3000/api/board/KOD/action/toggle_timeout_a`
- `GET http://localhost:3000/api/board/KOD/action/toggle_timeout_b`
- `GET http://localhost:3000/api/board/KOD/action/end_timeout`
- `GET http://localhost:3000/api/board/KOD/action/undo`
- `GET http://localhost:3000/api/board/KOD/action/swap_sides`
- `GET http://localhost:3000/api/board/KOD/action/clock_toggle`
