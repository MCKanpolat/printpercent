# PrintPercent

Creality K1C ve Snapmaker U1'in baskı yüzdesini yerel ağdan okuyup eWeLink CUBE çalışan SONOFF iHost'a aktarır. Her yazıcı bir salt okunur **Baskı İlerlemesi** sensörü olarak görünür. Apple Ev'de yüzdeyi göstermek için Matter'ın nem sensörü alanı kullanılır. Örneğin Ev'de K1C için görünen **%42 nem**, baskının %42 tamamlandığı anlamına gelir.

- **K1C** Creality'nin yerel WebSocket kanalını (`9999/tcp`) kullanır. Yazıcının firmware'i bu kanalı yerel ağa açmalı ve `deviceState` ile `printProgress` alanlarını sağlamalıdır. [K1 ailesi LAN protokolü](https://github.com/heydemoura/creality-orca-integration/blob/main/docs/protocol.md)
- **U1** Moonraker üzerinden (`7125/tcp`) baskı ilerlemesini okur. API anahtarı gerekiyorsa `U1_API_KEY` kullanılır. [Snapmaker Moonraker](https://github.com/Snapmaker/u1-moonraker) · [Moonraker durum alanları](https://moonraker.readthedocs.io/en/latest/printer_objects/)

## Kurulum

1. iHost'un ve iki yazıcının yerel IP adreslerini belirle. Köprüyü aynı ağdaki sürekli açık bir bilgisayarda, NAS'ta ya da Raspberry Pi'de çalıştır. Node.js 24 veya Docker Compose yeterli.
2. iHost web arayüzünde oturum aç. [eWeLink Open API talimatındaki](https://ewelink.cc/ewelink-cube/introduce-open-api/document/) iHost yetkilendirme düğmesine bastıktan hemen sonra PowerShell'de şu komutu çalıştır. Örnek adresi iHost adresinle değiştir.

   ```powershell
   (Invoke-RestMethod 'http://192.168.1.10/open-api/v2/rest/bridge/access_token?app_name=PrintPercent' -ContentType 'application/json').data.token
   ```

3. `.env.example` dosyasını `.env` olarak kopyala. IP adreslerini ve `IHOST_TOKEN` değerini doldur. `SERVICE_URL` içinde köprünün **çalıştığı makinenin** LAN adresini kullan. Örnek port `8787`, yol `/ihost`. iHost bu adrese yerel ağdan ulaşabilmeli.
4. Köprüyü başlat.

   ```powershell
   node --env-file=.env bridge.mjs
   ```

   Docker Compose kullanıyorsan `docker compose up -d --build` ile başlat ve `docker compose logs -f` ile izle.

5. Yazıcıların açık olduğundan emin ol. Köprü ilk geçerli okumadan sonra sensörleri iHost'a ekler. iHost'taki **Matter Bridge** cihaz listesinde **K1C Baskı İlerlemesi** ve **U1 Baskı İlerlemesi** sensörlerini bul ve paylaş. iHost köprüsü zaten Apple Ev'e bağlıysa mevcut eşleştirmeyi kullan. [eWeLink Apple Ev eşleştirme kılavuzu](https://ewelink.org/docs/help-guide/apple-home-integration)
6. Apple Ev'de **İklim** bölümünü kontrol et ve bir deneme baskısında değeri yazıcı ekranıyla karşılaştır. iHost sürümünün Open API ile eklenen sanal sensörleri Matter Bridge'de sunması gerekir. Bu adım gerçek donanımda doğrulanmayı bekliyor.

Köprü döngüler arasında 10 saniye bekler. Yazıcıya erişilemezse kayıtlı sensörü iHost'ta çevrimdışı işaretler. U1 boşta veya iptal edilmişse %0, tamamlanmışsa %100 gösterir. K1C boşta iken %0 gösterir ve cihaz %100 bildiriyorsa bu değeri korur. `.env` dosyası Git tarafından yok sayılır.
