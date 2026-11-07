# Transkripsi percakapan dengan beberapa pembicara

## Temuan pada proyek ini

Whisper lokal saat ini menghasilkan teks dan timestamp tanpa identitas suara.
`_transcribe_local_video_file` menyimpan segmen ucapan, bukan label pembicara.
Model analisis akhirnya menerima percakapan sebagai rangkaian teks tanpa bukti
siapa yang mengucapkan setiap kalimat. Mengganti prompt saja tidak dapat
mengembalikan kata dari pembicara yang tidak berhasil ditranskripsi.

Label `speaker`, beberapa `speakers`, dan penanda `overlap` sekarang dapat
dipertahankan dalam transkrip/proyek dan diteruskan ke analisis. Prompt analisis
meminta konteks tanya-jawab, bantahan, kutipan, dan penyelesaian percakapan,
serta melarang menebak identitas dari nama channel/judul. Label yang tidak
tersedia ditulis UNKNOWN; label pembicara tidak dibuat-buat dari teks.

**Diarization akustik belum dipasang atau dijalankan.** Perubahan ini menyiapkan
alur data dan memperbaiki pemakaian konteks, bukan menyatakan bahwa suara yang
hilang sudah berhasil dipulihkan.

## Alur yang direkomendasikan

1. Simpan audio sumber. Periksa apakah tiap mikrofon tersedia pada kanal
   terpisah; gunakan kanal tersebut bila memang masing-masing berisi satu suara.
2. Transkripsi multilingual menggunakan Whisper/WhisperX. Uji `large-v3` atau
   `turbo` terhadap `small` pada cuplikan Indonesia yang sama; pergantian model
   harus berdasarkan kata yang terlewat dan ketepatan ucapan, bukan nama model.
3. Jalankan **pyannote `speaker-diarization-community-1`** untuk mendapatkan
   interval SPEAKER_00, SPEAKER_01, dan seterusnya. ID adalah pengenal suara,
   bukan nama orang. Nama baru boleh ditautkan bila ada bukti/konfirmasi.
4. Selaraskan kata dengan giliran pembicara. Pertahankan output diarization
   biasa untuk informasi ucapan bertumpuk; exclusive diarization membantu
   penyelarasan tetapi tidak merepresentasikan beberapa suara sekaligus.
5. Untuk bagian bertumpuk yang kehilangan kata, uji pemisahan suara lalu
   transkripsi tiap jalur. WhisperX sendiri mengakui keterbatasan pada overlapping
   speech. Menambahkan label speaker saja tidak menyelesaikan kehilangan ucapan.
6. Kirim segmen `{start,end,text,speaker,speakers,overlap}` ke analyzer. Pilih klip
   yang mencakup pertanyaan dan jawaban/bantahan yang dibutuhkan, bukan hanya
   pernyataan provokatif yang kehilangan konteks.

Gunakan lingkungan Python terpisah untuk mencoba WhisperX/pyannote agar paket
Torch/CUDA aplikasi yang sedang merender tidak berubah. Model pyannote ini
memerlukan penerimaan ketentuan akses dan token Hugging Face untuk unduhan.
Simpan token melalui konfigurasi lokal; jangan masukkan ke proyek, cache atau Git.
Sesudah model diunduh, pemrosesan dapat dilakukan secara lokal. Cache diarization
berdasarkan hash audio, model/versi dan pengaturan; cache transkripsi juga harus
membedakan model serta bahasa. Hindari menjalankannya bersamaan dengan render
GPU sebelum kebutuhan VRAM pada mesin ini diukur.

## Pengujian sebelum dipakai untuk video panjang

Bandingkan beberapa cuplikan pendek: dua orang bergantian, suara pelan,
interupsi/ucapan bertumpuk, serta tanya-jawab dengan bantahan. Periksa kata
yang hilang per pembicara, pergantian speaker, kesalahan atribusi pendapat dan
apakah rekomendasi menyertakan konteks lengkap. Lanjutkan ke video panjang
hanya setelah hasil cuplikan tersebut memadai. Label yang benar tidak menjamin
semua kata dalam audio bertumpuk berhasil dikenali.

## Sumber utama

- [WhisperX: diarization dan keterbatasan](https://github.com/m-bain/whisperX)
- [Model pyannote Community-1, akses dan output exclusive](https://huggingface.co/pyannote/speaker-diarization-community-1)
- [Whisper: model multilingual dan kebutuhan memori](https://github.com/openai/whisper)
- [Pipeline speech separation pyannote](https://github.com/pyannote/pyannote-audio/blob/main/src/pyannote/audio/pipelines/speech_separation.py)
