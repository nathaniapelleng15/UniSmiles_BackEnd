-- Kalibrasi cetak + penyesuaian tampilan foto, disimpan di konfigurasi cetak
-- per kiosk yang SUDAH ada.
--
-- Kenapa di tabel ini, bukan tabel/tempat baru:
--   `kiosk_printing_configs` sudah menjadi satu sumber kebenaran per kiosk, dan
--   jalurnya sudah tersambung utuh: Admin -> backend -> kiosk-agent ->
--   reportedState -> local bridge -> photobooth. Menaruh nilai ini di tempat
--   lain berarti membuat sumber kedua yang bisa berbeda dengan yang pertama —
--   persis pola yang sudah dua kali menyebabkan bug (ukuran kertas & path aset).
--
-- IDEMPOTEN. MySQL 8.x TIDAK mendukung `ADD COLUMN IF NOT EXISTS` (itu fitur
-- MariaDB), jadi pengecekan dilakukan lewat INFORMATION_SCHEMA + prepared
-- statement. Aman dijalankan berulang: kalau kolom sudah ada, tidak ada yang
-- diubah dan tidak ada error.
--
-- Cara pakai (dari folder unismiles-backend):
--   mysql -h <host> -P <port> -u <user> -p <db> < migrate_print_calibration.sql

-- Prosedur sementara: menambah kolom hanya kalau belum ada.
DROP PROCEDURE IF EXISTS unismiles_add_column_if_missing;

DELIMITER //# Task: Integrasi GoPay Merchant via AlfinAI/QrisMerchantID

Kita memiliki aplikasi photobooth dengan backend sendiri dan MySQL lokal di port 3306.

Saat ini verifikasi pembayaran menggunakan metode lama/computer vision. Kita ingin melakukan POC dan kemudian integrasi pembayaran otomatis menggunakan repository:

https://github.com/AlfinAI/QrisMerchantID

Provider yang ingin digunakan hanya:

GoPay Merchant

Kita TIDAK memiliki GoBiz.

Repository tersebut unofficial/reverse-engineered, jadi implementasi harus dibuat terisolasi, mudah dimatikan, dan tidak boleh langsung menggantikan payment flow production.

Tujuan utama:

GoPay Merchant
→ transaction history
→ payment matcher
→ database
→ payment session PAID
→ photobooth boleh memulai sesi foto


# Prinsip Implementasi

Jangan langsung mengubah flow production.

Kerjakan secara bertahap.

Urutan wajib:

Phase 0: inspect project
Phase 1: isolated GoPay POC
Phase 2: provider adapter
Phase 3: database/payment matcher
Phase 4: photobooth integration
Phase 5: tests
Phase 6: staged rollout

Jangan implementasikan phase berikutnya apabila phase sebelumnya belum mempunyai hasil yang dapat diverifikasi.


# PHASE 0 — Audit Existing Project

Sebelum coding:

1. Inspect seluruh struktur project.

Cari:

- bahasa/framework backend
- package manager
- ORM/database layer
- existing payment logic
- existing payment/session tables
- current QRIS logic
- current computer vision payment confirmation
- photobooth session lifecycle
- endpoint yang digunakan frontend/device
- background worker/job mechanism
- websocket/SSE/polling yang sudah ada
- existing logging system
- existing `.env`
- migration system

Jangan membuat arsitektur baru apabila project sudah memiliki abstraction yang bisa digunakan.

Buat laporan singkat:

docs/gopay-merchant-integration-plan.md

Dokumentasikan:

- current architecture
- titik integrasi paling aman
- file yang perlu diubah
- file baru yang perlu dibuat
- migration yang dibutuhkan
- risiko yang ditemukan


# Architectural Decision

QrisMerchantID adalah Python library.

Jika backend project sudah Python 3.10+:

gunakan library secara langsung melalui provider/service abstraction.

Jika backend utama Node.js/TypeScript atau bahasa lain:

JANGAN port reverse-engineered GoPay API ke JavaScript terlebih dahulu.

Buat internal Python adapter/service kecil yang menjadi boundary terhadap QrisMerchantID.

Contoh:

photobooth backend
        |
        | internal API
        v
gopay-merchant-adapter (Python)
        |
        v
QrisMerchantID
        |
        v
GoPay Merchant API

Service ini harus private/internal only.

Jangan expose langsung ke internet.


# Dependency Strategy

Jangan menggunakan dependency floating/unpinned.

Clone atau install QrisMerchantID lalu pin exact version / git commit SHA yang sedang diuji.

Catat SHA tersebut dalam:

docs/gopay-merchant-integration-plan.md

Semua komunikasi GoPay Merchant harus lewat satu adapter layer.

Jangan menyebarkan pemanggilan QrisMerchantID ke banyak bagian application.


# PHASE 1 — GoPay Merchant Compatibility POC

Ini adalah blocker utama.

Buat POC terisolasi sebelum menyentuh payment system.

Minimal buat command/script untuk:

1. Request OTP
2. Submit OTP
3. Simpan session
4. Validate session
5. List merchant/outlet yang tersedia
6. Ambil transaction history
7. Normalize transaction response
8. Test token refresh/re-auth behaviour


## POC Commands

Buat command yang kira-kira bisa dijalankan seperti:

gopay-poc request-otp

gopay-poc verify-otp 123456

gopay-poc merchants

gopay-poc transactions --days 1

gopay-poc watch


Jangan menyimpan OTP.

OTP hanya digunakan sekali saat login.


# Important: Money Normalization

QrisMerchantID menjelaskan bahwa nominal GoPay dikembalikan menggunakan minor units.

Contoh konsep:

gross_amount = 10600000

dapat berarti:

Rp106.000

JANGAN pernah membandingkan `gross_amount` mentah dengan amount photobooth.

Selalu gunakan normalization function dari library, misalnya:

gopay.money.to_rupiah(...)

Internal application harus bekerja menggunakan integer rupiah:

30000
30001
30002

Bukan float.

Bukan decimal string.

Bukan minor units.


# PHASE 1 Success Criteria

POC dinyatakan PASS hanya apabila menggunakan akun GoPay Merchant kita yang sebenarnya dan berhasil:

OTP login
→ session valid

session
→ merchant ditemukan

merchant
→ transaction history berhasil dibaca

real incoming QRIS payment
→ muncul sebagai transaction

transaction
→ memiliki stable transaction identifier

transaction
→ memiliki amount yang benar setelah normalization

transaction
→ timestamp dapat digunakan

Restart POC lalu pastikan session/token behavior diketahui.

Catat latency:

payment dilakukan pada T0

transaction pertama kali terlihat pada T1

latency = T1 - T0


# STOP CONDITION

Jika akun GoPay Merchant kita ternyata tidak kompatibel dengan auth yang dipakai QrisMerchantID:

STOP.

Jangan membuat workaround besar atau reverse-engineer endpoint baru.

Dokumentasikan masalahnya terlebih dahulu.


# PHASE 2 — Create Payment Provider Adapter

Jangan membuat business logic photobooth tergantung pada QrisMerchantID secara langsung.

Buat abstraction seperti:

PaymentProvider

dengan operasi konseptual:

health_check()

authenticate()

get_merchants()

get_recent_transactions()

normalize_transaction()

refresh_session()


Implementasi:

GoPayMerchantProvider


Normalized transaction internal minimal:

provider

provider_transaction_id

merchant_id

amount_rupiah

transaction_time

status

raw_payload


Raw provider payload boleh disimpan untuk debugging tetapi jangan digunakan langsung sebagai business logic.


# Authentication State

Token/session GoPay adalah secret.

Requirements:

- jangan commit token
- jangan log access token
- jangan log refresh token
- jangan log OTP
- jangan expose token ke frontend
- jangan expose token ke photobooth device

Jika session perlu persistent:

simpan di secure server-side storage.

Untuk POC single-server, file di luar repository dengan permission ketat diperbolehkan.

Untuk production, gunakan encrypted storage / secret storage yang sesuai existing infrastructure.


# Environment Variables

Tambahkan `.env.example`, tetapi jangan isi secret nyata.

Contoh conceptual configuration:

PAYMENT_PROVIDER=legacy_cv

GOPAY_ENABLED=false

GOPAY_PHONE=

GOPAY_MERCHANT_ID=

GOPAY_SESSION_PATH=

GOPAY_POLL_INTERVAL_SECONDS=10

GOPAY_TRANSACTION_LOOKBACK_SECONDS=300

GOPAY_PAYMENT_GRACE_SECONDS=30

GOPAY_REQUEST_TIMEOUT_SECONDS=10


Existing production default HARUS tetap menggunakan payment provider lama sampai rollout selesai.


# PHASE 3 — Database Model

Inspect schema yang ada terlebih dahulu.

Reuse existing payment/session model apabila memungkinkan.

Kita membutuhkan konsep berikut.


## payment_sessions

Minimal mempunyai:

id

device_id / booth_id

base_amount

unique_code

expected_amount

status

provider

provider_transaction_id

created_at

expires_at

paid_at


Status minimal:

PENDING

PAID

EXPIRED

CANCELLED


Provider:

gopay_merchant_unofficial


# Unique Amount Strategy

Untuk tahap pertama, tetap gunakan unique amount.

Contoh:

Harga paket:

Rp30.000

Session A:

Rp30.001

Session B:

Rp30.002

Session C:

Rp30.003


Server harus menjadi satu-satunya pihak yang mengalokasikan unique code.

Jangan generate random code hanya di frontend.


# Active Amount Reservation

Tidak boleh ada dua payment session aktif dengan expected_amount yang sama untuk merchant yang sama.

Gunakan database locking atau reservation table.

Contoh konsep:

payment_amount_reservations

merchant_id

expected_amount

payment_session_id

expires_at

Buat UNIQUE constraint terhadap:

merchant_id + expected_amount


Saat session:

PAID
EXPIRED
CANCELLED

reservation harus dilepas.


# Provider Transactions Table

Buat/reuse storage untuk transaksi provider.

Minimal:

id

provider

provider_transaction_id

merchant_id

amount_rupiah

raw_amount

transaction_time

raw_payload

claimed_payment_session_id

created_at


WAJIB ada unique constraint:

provider + provider_transaction_id


Satu transaksi GoPay tidak boleh digunakan untuk membayar dua photobooth session.


# PHASE 3 — Transaction Poller

Jangan membuat satu poller per photobooth.

Jangan membuat satu poller per payment session.

Harus ada SATU centralized poller per merchant/account.

Contoh:

GoPayPoller
    |
    +-- request latest transactions
    |
    +-- normalize
    |
    +-- deduplicate
    |
    +-- store
    |
    +-- run matcher


Polling interval configurable.

Mulai konservatif:

10 seconds

Setelah live testing stabil, baru evaluasi 5 seconds jika diperlukan.

Jangan aggressively hit unofficial API.


# Error Handling

Handle minimal:

network timeout

DNS failure

connection reset

HTTP 401

expired token

refresh failure

rate limit

malformed provider response

empty transaction result

provider schema changed


Jika refresh session gagal:

jangan terus menerus spam login/API.

Masuk ke state:

AUTH_REQUIRED

dan beri alert/log yang jelas.


Gunakan exponential backoff pada transient network failure.

Tambahkan jitter agar tidak membuat synchronized retry loop.


# Circuit Breaker

Jika provider terus gagal:

jangan membuat request tanpa batas.

Contoh conceptual states:

HEALTHY

DEGRADED

AUTH_REQUIRED

OFFLINE


Payment creation harus mengetahui status provider.

Jangan memberitahu photobooth bahwa payment watcher sehat jika provider sedang mati.


# PHASE 3 — Payment Matcher

Matching harus server-side dan atomic.

Algoritma dasar:

incoming GoPay transaction
        |
        v
normalize amount to integer rupiah
        |
        v
deduplicate provider_transaction_id
        |
        v
find PENDING payment_session
where expected_amount == transaction.amount
        |
        v
validate time window
        |
        v
lock rows
        |
        v
claim transaction
        |
        v
mark session PAID


Time validation:

transaction tidak boleh berasal jauh sebelum session dibuat.

Gunakan configurable grace period untuk clock/provider timestamp difference.

Conceptually:

transaction_time >= session.created_at - grace

dan:

transaction_time <= session.expires_at + grace


# Atomic Claim

Payment confirmation harus berada dalam satu DB transaction.

Pseudo-flow:

BEGIN

SELECT provider_transaction
FOR UPDATE

pastikan belum claimed

SELECT payment_session
FOR UPDATE

pastikan status masih PENDING

pastikan amount cocok

pastikan timestamp valid

UPDATE provider_transaction
SET claimed_payment_session_id = session_id

UPDATE payment_session
SET
    status = PAID,
    provider_transaction_id = ...,
    paid_at = ...

COMMIT


Duplicate polling tidak boleh menyebabkan duplicate activation.


# Late Payments

Jika transaksi masuk setelah payment session expired:

jangan otomatis menjalankan photobooth.

Store transaction sebagai:

UNMATCHED / LATE

dan tulis log agar dapat direkonsiliasi admin.


# Ambiguous Match

Jika karena bug/data terdapat lebih dari satu candidate session:

JANGAN pilih secara random.

JANGAN otomatis claim.

Mark transaction sebagai ambiguous dan log error.


# PHASE 4 — Photobooth API Integration

Reuse API architecture yang sudah ada.

Flow target:

POST create payment session

→ server reserve unique amount

→ response:

payment_session_id
base_amount
unique_code
expected_amount
expires_at
payment_status


Photobooth UI menampilkan:

QRIS existing

dan:

Bayar tepat Rp30.001


Client kemudian menunggu status:

PENDING

menjadi:

PAID


Jika existing application sudah mempunyai WebSocket/SSE:

reuse.

Jika belum:

simple status polling sudah cukup untuk tahap pertama.

Contoh:

GET /api/payment-sessions/{id}

response:

{
  "id": "...",
  "status": "PAID",
  "amount": 30001
}


Photobooth hanya boleh memulai kamera/session setelah backend mengatakan:

PAID


Jangan percaya status dari frontend.


# Existing Computer Vision Flow

Jangan langsung hapus sistem lama.

Tambahkan feature flag/provider selection.

Contoh:

PAYMENT_PROVIDER=legacy_cv

atau

PAYMENT_PROVIDER=gopay_merchant_unofficial


Selama staging, legacy system harus bisa diaktifkan kembali tanpa code rollback.


# PHASE 4B — Dynamic QRIS

JANGAN kerjakan ini sampai transaction reading + matching benar-benar stabil.

QrisMerchantID mempunyai QRIS helper, tetapi helper tersebut membangun payload QRIS secara lokal.

Setelah payment confirmation stabil, baru evaluasi:

static QRIS
+
unique amount

versus:

locally generated dynamic QRIS


Dynamic QRIS bukan dependency untuk keberhasilan POC pertama.


# PHASE 5 — Testing

Tambahkan automated test untuk minimal scenario berikut:

normal payment match

amount normalization

duplicate transaction

duplicate polling

same transaction received multiple times

two booths requesting same package simultaneously

unique amount allocation

session expiration

late payment

transaction before session creation

network timeout

provider unavailable

401 token expiry

refresh token success

refresh token failure

database restart/reconnect

application restart

poller restart

transaction appearing after poller restart

ambiguous matching


Semua provider tests sebisa mungkin menggunakan mock/fixture.

Automated tests tidak boleh melakukan real payment.


# Live Test Plan

Setelah unit/integration test PASS:

gunakan payment real dalam jumlah test yang terkontrol.

Test:

single booth

multiple sequential payments

multiple concurrent booths

same base package

payment tepat sebelum expiry

payment setelah expiry

backend restart saat payment pending

poller restart

temporary internet disconnect


Untuk setiap pembayaran log:

payment_session_id

expected_amount

provider_transaction_id

created_at

provider_transaction_time

detected_at

paid_at

detection_latency_ms


Jangan log token atau credential.


# Observability

Tambahkan structured logs untuk:

gopay.auth.success

gopay.auth.required

gopay.poll.success

gopay.poll.failed

gopay.transaction.new

payment.match.success

payment.match.none

payment.match.ambiguous

payment.session.expired


Tambahkan health information:

last_successful_poll

last_provider_transaction_time

auth_state

consecutive_failures

poll_latency


# Recommended Metrics

Jika project sudah mempunyai metrics system, tambahkan:

gopay_poll_success_total

gopay_poll_error_total

gopay_transactions_seen_total

payment_match_success_total

payment_match_ambiguous_total

payment_match_late_total

gopay_poll_latency_ms

payment_detection_latency_ms


# GO / NO-GO Criteria

Jangan aktifkan production hanya karena login berhasil.

GO hanya apabila:

OTP login bekerja dengan akun GoPay Merchant kita

merchant/account ditemukan

incoming QRIS transaction terbaca

amount normalization benar

transaction ID stabil

transaction timestamp usable

polling dapat berjalan lama tanpa auth loop

token/session recovery dipahami

restart tidak menyebabkan duplicate payment

concurrent sessions tidak salah match

tidak pernah ada transaction double-claimed

20+ test payment berturut-turut berhasil tanpa false positive

payment detection latency acceptable untuk photobooth


Target awal detection latency:

normal < 15 seconds


NO-GO apabila:

login ternyata membutuhkan GoBiz

session sering invalid

OTP dibutuhkan berulang kali

GoPay melakukan device binding yang tidak stabil

transaction history terlambat secara signifikan

transaction identifier tidak stabil

schema sering berubah

terjadi rate limiting berat

akun mendapatkan warning/restriction

terjadi false payment match


# Important Safety Rules

Jangan hardcode undocumented GoPay endpoint di core backend.

Semua undocumented behavior harus tetap berada di adapter QrisMerchantID boundary.

Jangan commit:

OTP

phone number jika tidak perlu

access token

refresh token

session cache

HAR captures

merchant credentials


Pastikan `.gitignore` mencakup session/token files.


# Deliverables

Pada tahap awal hasil yang saya inginkan:

1. Audit existing project.

2. `docs/gopay-merchant-integration-plan.md`.

3. QrisMerchantID pinned dependency/clone.

4. Isolated GoPay POC.

5. OTP request/verify flow.

6. Merchant discovery.

7. Transaction history reader.

8. Normalized transaction output.

9. Session persistence/refresh test.

10. POC report berisi PASS/FAIL untuk kompatibilitas akun GoPay Merchant.


JANGAN dahulu:

menghapus computer vision

mengubah production default payment provider

membuat dynamic QRIS production

mengaktifkan auto-start photobooth production


Setelah POC selesai, tulis hasil seperti:

GOPAY MERCHANT POC

Auth:
PASS / FAIL

Merchant discovery:
PASS / FAIL

Transaction history:
PASS / FAIL

Real QRIS payment detected:
PASS / FAIL

Amount normalization:
PASS / FAIL

Stable transaction ID:
PASS / FAIL

Token refresh:
PASS / FAIL

Average detection latency:
...

Risks:
...

Recommendation:
PROCEED_TO_INTEGRATION / STOP_AND_REASSESS


Jika POC PASS, lanjutkan Phase 2–5.

Jika FAIL, berhenti dan dokumentasikan blocker. Jangan melakukan reverse engineering tambahan tanpa review.
CREATE PROCEDURE unismiles_add_column_if_missing(
  IN p_table VARCHAR(64),
  IN p_column VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND COLUMN_NAME = p_column
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_definition);
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END //
DELIMITER ;

-- Kepekatan termal (nilai `density` pada driver Niimbot, 1-5).
-- Sebelumnya hanya bisa diatur di halaman uji localhost.
CALL unismiles_add_column_if_missing('kiosk_printing_configs', 'thermal_density',
  "TINYINT UNSIGNED NOT NULL DEFAULT 3 COMMENT 'Kepekatan cetak termal 1-5'");

-- Geser vertikal cetak dalam piksel, untuk kalibrasi registrasi kertas:
-- positif menggeser gambar ke bawah, negatif ke atas.
CALL unismiles_add_column_if_missing('kiosk_printing_configs', 'thermal_offset_y_px',
  "SMALLINT NOT NULL DEFAULT 0 COMMENT 'Geser vertikal cetak (px)'");

-- Cara foto menempati label: 'fit' (jaga rasio + bingkai putih) atau
-- 'stretch' (penuhi label, bisa gepeng).
CALL unismiles_add_column_if_missing('kiosk_printing_configs', 'photo_fit_mode',
  "VARCHAR(10) NOT NULL DEFAULT 'fit' COMMENT 'fit = jaga rasio; stretch = penuhi label'");

-- Penyesuaian tampilan FOTO HASIL cetak, dalam persen.
-- CATATAN PENTING: ini tidak berlaku untuk frame yang dikirim ke OCR verifikasi
-- pembayaran. Jalur OCR punya filter sendiri yang sudah dikalibrasi agar nominal
-- struk terbaca; mengubahnya dari sini akan merusak verifikasi pembayaran.
CALL unismiles_add_column_if_missing('kiosk_printing_configs', 'photo_brightness',
  "TINYINT UNSIGNED NOT NULL DEFAULT 100 COMMENT 'Kecerahan foto hasil cetak (%) 50-150'");
CALL unismiles_add_column_if_missing('kiosk_printing_configs', 'photo_contrast',
  "TINYINT UNSIGNED NOT NULL DEFAULT 100 COMMENT 'Kontras foto hasil cetak (%) 50-150'");
CALL unismiles_add_column_if_missing('kiosk_printing_configs', 'photo_saturation',
  "TINYINT UNSIGNED NOT NULL DEFAULT 100 COMMENT 'Saturasi foto hasil cetak (%) 0-150'");

DROP PROCEDURE IF EXISTS unismiles_add_column_if_missing;
