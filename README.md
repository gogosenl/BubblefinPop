# Bubblefin Pop

Renkli su balonlarını birleştirip balon balıklarını özgür bıraktığın, Expo ve React Native ile geliştirilmiş portre mobil bulmaca oyunu.

## Oyun deneyimi

- Profesyonel ana ekran, bölüm haritası ve ayarlar ekranı
- Bubblefin Pop ve Görsen Games markalı animasyonlu açılış; gerçek dosya yüklenmesini izleyen yüzde göstergeli ilerleme çubuğu
- Animasyonlu bölüm kartları, tamamlanma madalyaları ve özel tebrik ekranı
- 16 dünyaya ayrılmış 800 oynanabilir bölüm; her dünyada 50 bölüm
- İlk üç bölümde renkleri ve birleştirmeyi adım adım öğreten etkileşimli alıştırmalar
- Türkçe ve İngilizce arayüz
- Ayrı ayrı açılıp kapatılabilen su altı fon müziği ve su balonu hissi veren düşüş, birleşme ve patlama efektleri
- Adil renk torbası sayesinde sekizden fazla balon boyunca eksik renk bekletmeyen bölüm sistemi
- Dil, müzik ve bölüm ilerlemesini cihazda otomatik kaydetme

## Expo Go ile test

PowerShell betik kısıtlamasına ve Expo oturum sunucusu hatalarına takılmamak için proje klasöründe çevrimdışı Metro modunu kullan:

```powershell
npm.cmd start -- --clear
```

Expo Go ile terminaldeki QR kodu okut.

Android emülatörünü doğrudan açmak için:

```powershell
npm.cmd run android -- --clear
```

Bu komut Expo'nun çevrim içi geliştirme oturumu servisini kullanmaz; oyun ve QR bağlantısı yerel ağda çalışmaya devam eder.

## Kontroller

- Oyun alanında basılı tut; balonu sağa-sola sürükleyerek hizala ve düşürmek için parmağını bırak.
- Fırlatma alanının sağındaki küçük balon, bir sonraki rengi önceden gösterir; mevcut balon bırakılınca yuvarlanarak fırlatma konumuna gelir.
- Aynı renkteki balonlar temas ettikleri anda birleşir.
- Balon balığı sayısı arttıkça balon büyür.
- Hedef sayıya ulaşan tek renkli balon patlar ve balon balıkları özgür kalır.

## iOS üretim kontrolü

```powershell
npm.cmd run typecheck
npm.cmd run audit:levels
npm.cmd run audit:audio
npx.cmd expo export --platform ios --clear
```

## App Store derlemesi

Apple Developer ve Expo hesapları bağlandıktan sonra:

```powershell
npx.cmd eas-cli build --platform ios --profile production
npx.cmd eas-cli submit --platform ios --profile production
```

Yayın öncesinde App Store Connect içinde ekran görüntüleri, yaş derecelendirmesi, destek ve gizlilik politikası bağlantıları ayrıca doldurulmalıdır.
