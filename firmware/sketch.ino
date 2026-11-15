// Astro Hiyoko - 太空艙健康監測閘道器 (ESP32 / Wokwi)
//
// 一塊 ESP32 負責五位太空人 (Mira, Kai, Lin, Noa, Sol)：
//   - Mira 的數值讀電路上的滑桿 (2 顆 ADS1115)
//   - 其他人播放資料組的 dataset-v2 (crew_data.h，10 分鐘循環)
//   - 裝置端先判斷 normal / warning / critical，放在 context.deviceAlert
//   - 依 schema 1.3 組成 JSON，HTTP POST 到後端
//
// FreeRTOS 三個任務：
//   vitalsTask    每 0.5 秒：心率、血氧、體溫、血壓
//   secondaryTask 每 2 秒  ：呼吸頻率、狀態摘要
//   transmitTask           ：五個人輪流送出

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Wire.h>
#include "crew_data.h"         // 由 tools/make_crew_data.py 產生
#include <time.h>
#include <sys/time.h>
#include <stdarg.h>

// ---------------------------------------------------------------------
// 門檻值
// These thresholds are illustrative software-testing values,
// not validated NASA flight medical alert thresholds.
//
// critical：< CRIT_LOW 或 >= CRIT_HIGH
// warning ：< WARN_LOW 或 >  WARN_HIGH
// ---------------------------------------------------------------------

// 心率 (/min)  normal 60-100
const float HR_CRIT_LOW   = 40;
const float HR_WARN_LOW   = 60;
const float HR_WARN_HIGH  = 100;
const float HR_CRIT_HIGH  = 150;

// 血氧 (%)  只看太低
const float SPO2_WARN_LOW = 95;
const float SPO2_CRIT_LOW = 93;

// 呼吸頻率 (/min)  normal 12-20
const float RR_CRIT_LOW   = 9;
const float RR_WARN_LOW   = 12;
const float RR_WARN_HIGH  = 20;
const float RR_CRIT_HIGH  = 30;

// 收縮壓 (mm[Hg])  normal 100-120
const float SBP_CRIT_LOW  = 90;
const float SBP_WARN_LOW  = 100;
const float SBP_WARN_HIGH = 120;
const float SBP_CRIT_HIGH = 180;

// 舒張壓 (mm[Hg])  normal 60-80
const float DBP_CRIT_LOW  = 50;
const float DBP_WARN_LOW  = 60;
const float DBP_WARN_HIGH = 80;
const float DBP_CRIT_HIGH = 110;

// 體溫 (Cel)  normal 36.5-37.5
const float TEMP_CRIT_LOW  = 35.0;
const float TEMP_WARN_LOW  = 36.5;
const float TEMP_WARN_HIGH = 37.5;
const float TEMP_CRIT_HIGH = 39.0;

// ---------------------------------------------------------------------
// 封包格式 (schema 1.3，單位用 UCUM)
// ---------------------------------------------------------------------
const char* SCHEMA_VERSION = "1.3";

const char* UNIT_HR   = "/min";
const char* UNIT_SPO2 = "%";
const char* UNIT_TEMP = "Cel";
const char* UNIT_BP   = "mm[Hg]";
const char* UNIT_RR   = "/min";
const char* UNIT_WOB  = "1";

const char* METRIC_METHOD = "mock_generated";

// 呼吸頻率的觀察時間 (秒)
// TODO: 先用文件的範例值 60，之後改成實際的計算視窗
const int RR_OBSERVATION_SEC = 60;

// ---------------------------------------------------------------------
// Wi-Fi / NTP
// ---------------------------------------------------------------------
const char* WIFI_SSID     = "Wokwi-GUEST";
const char* WIFI_PASSWORD = "";
const int   WIFI_CHANNEL  = 6;
const unsigned long WIFI_TIMEOUT_MS = 15000;

const char* NTP_SERVER_1 = "pool.ntp.org";
const char* NTP_SERVER_2 = "time.google.com";
const char* NTP_SERVER_3 = "time.cloudflare.com";

// 2024-01-01，比這個晚就當作已經校時
const time_t VALID_TIME_AFTER = 1704067200;

// ---------------------------------------------------------------------
// 後端
// ---------------------------------------------------------------------

// http:// 或 https:// 都可以，程式會依網址決定要不要加密
// Wokwi 連 ngrok 用 https 會在 TLS 握手時斷線 (-29312)，所以先用 http
// TODO: 換成實體 ESP32 或其他伺服器後改回 https
const char* SERVER_URL = "http://taliyah-unfalsifiable-overcredulously.ngrok-free.dev/v1/telemetry";

// Token 不存檔：測試時才貼上，跑完不要 Save
// 還是 PASTE- 開頭的人會被跳過
// 順序：Mira, Kai, Lin, Noa, Sol
const char* DEVICE_TOKENS[] = {
  "PASTE-MIRA-TOKEN-HERE",
  "PASTE-KAI-TOKEN-HERE",
  "PASTE-LIN-TOKEN-HERE",
  "PASTE-NOA-TOKEN-HERE",
  "PASTE-SOL-TOKEN-HERE",
};

// ISRG Root X1 (https 時用來驗證 ngrok 的憑證)
const char* ROOT_CA = R"EOF(-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc
h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+
0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U
A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW
T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH
B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC
B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv
KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn
OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn
jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw
qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI
rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV
HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq
hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL
ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ
3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK
NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5
ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur
TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC
jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc
oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq
4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA
mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d
emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=
-----END CERTIFICATE-----
)EOF";

// false = 只加密不驗證 (只用在 demo)
const bool VERIFY_SERVER_CERT = true;

const int HTTP_TIMEOUT_MS = 8000;
const int MAX_ATTEMPTS    = 3;
const int RETRY_DELAYS_MS[] = { 250, 500 };

// 每送完一包休息 1 秒，五個人輪流
const int SEND_GAP_MS = 1000;

// ---------------------------------------------------------------------
// 滑桿 (兩顆 ADS1115，代表一位太空人)
//   0x49: A0 體溫 | A1 心率 | A2 血氧 | A3 ECG 心率
//   0x4A: A0 收縮壓 | A1 舒張壓 | A2 IMU | A3 呼吸頻率
// ---------------------------------------------------------------------

// 電路代表的太空人 (0 = Mira)
const int CIRCUIT_CREW_INDEX = 0;

const int I2C_SDA_PIN = 21;
const int I2C_SCL_PIN = 22;
const uint8_t ADS_ADDR[2] = { 0x49, 0x4A };
const int ADS_CONVERSION_MS = 10;   // 128 SPS 約 8 ms

enum PotIndex {
  POT_TEMP = 0, POT_HR = 1, POT_SPO2 = 2, POT_ECG = 3,
  POT_SBP  = 4, POT_DBP = 5, POT_IMU = 6,  POT_RR  = 7,
  POT_COUNT = 8
};

// 滑桿最左 / 最右對應的數值，和雜訊大小
const float POT_LO[POT_COUNT]    = { 34.0,  30.0,  70.0,  30.0,  70.0,  40.0, 0.0,  4.0 };
const float POT_HI[POT_COUNT]    = { 41.0, 180.0, 100.0, 180.0, 200.0, 120.0, 1.0, 40.0 };
const float POT_NOISE[POT_COUNT] = { 0.04,   1.2,   0.4,   1.0,   1.5,   1.0, 0.0,  0.6 };

const bool ADD_POT_NOISE = true;

// ---------------------------------------------------------------------
// 任務設定
// ---------------------------------------------------------------------
const int VITALS_PERIOD_MS    = 500;
const int SECONDARY_PERIOD_MS = 2000;
const unsigned long STATUS_PRINT_INTERVAL_MS = 10000;

const int VITALS_PRIORITY    = 2;
const int SECONDARY_PRIORITY = 1;
const int TRANSMIT_PRIORITY  = 1;

const int VITALS_STACK    = 4096;
const int SECONDARY_STACK = 4096;
const int TRANSMIT_STACK  = 16384;   // JSON + TLS 需要比較大

// 除錯用：印出每包完整 JSON
const bool PRINT_FULL_JSON = false;

// ---------------------------------------------------------------------
// 資料結構
// (struct 要放在第一個函式之前，不然 Arduino 自動產生的函式宣告會找不到型別)
// ---------------------------------------------------------------------
enum AlertLevel {
  ALERT_NORMAL   = 0,
  ALERT_WARNING  = 1,
  ALERT_CRITICAL = 2
};

// 要跟 crew_data.h 的 flags 對應
enum SampleQuality {
  Q_GOOD    = 0,
  Q_POOR    = 1,   // motion_artifact
  Q_MISSING = 2    // no_sample，value 送 null
};

const int CREW_COUNT = 5;

struct CrewMember {
  const char* name;
  const char* deviceId;
  const char* assignmentId;

  // 最新讀值
  int   heartRate;
  float spo2;
  SampleQuality hrQuality;
  SampleQuality spo2Quality;
  bool  exercising;
  int   tempBpIndex;         // 第幾分鐘的體溫/血壓，-1 表示每包都送
  float temperature;
  int   systolicBP;
  int   diastolicBP;
  int   respiratoryRate;
  int   workOfBreathing;

  // 判斷結果
  AlertLevel hrAlert;
  AlertLevel spo2Alert;
  AlertLevel tempAlert;
  AlertLevel sbpAlert;
  AlertLevel dbpAlert;
  AlertLevel rrAlert;
  AlertLevel overallAlert;

  char  observedAt[32];
  unsigned long observedUptimeMs;
  bool  observedClockSynced;
  bool  hasVitals;
  bool  hasRespiration;

  unsigned long seq;
};

struct VitalsSample {
  int   heartRate;
  float spo2;
  SampleQuality hrQuality;
  SampleQuality spo2Quality;
  bool  exercising;
  float temperature;
  int   systolicBP;
  int   diastolicBP;
  int   tempBpIndex;
};

CrewMember crew[CREW_COUNT] = {
  { "Mira", "mock-mira", "assignment-mira" },
  { "Kai",  "mock-kai",  "assignment-kai"  },
  { "Lin",  "mock-lin",  "assignment-lin"  },
  { "Noa",  "mock-noa",  "assignment-noa"  },
  { "Sol",  "mock-sol",  "assignment-sol"  },
};

const char* alertToText(AlertLevel level) {
  switch (level) {
    case ALERT_CRITICAL: return "critical";
    case ALERT_WARNING:  return "warning";
    default:             return "normal";
  }
}

// ---------------------------------------------------------------------
// 共用變數
// ---------------------------------------------------------------------
SemaphoreHandle_t dataMutex;     // crew[]、滑桿
SemaphoreHandle_t serialMutex;   // Serial

String bootId = "boot-unknown";

volatile unsigned long vitalsCount    = 0;
volatile unsigned long secondaryCount = 0;
volatile unsigned long sentOkCount    = 0;
volatile unsigned long sentFailCount  = 0;
volatile unsigned long skippedCount   = 0;

// 第一次能送資料時才開始播放，播放時間從 00:00 算
volatile bool          playbackStarted = false;
volatile unsigned long playbackStartMs = 0;

float potFrac[POT_COUNT] = { 0 };
bool  adsAlive[2] = { false, false };

// ---------------------------------------------------------------------
// 資料來源
// true : 播放 crew_data.h
// false: 用下面的固定值 (測試判斷用)
// ---------------------------------------------------------------------
const bool USE_PLAYBACK = true;

// 固定測試值，順序 Mira, Kai, Lin, Noa, Sol
//   Kai 心率偏低、Lin critical、Noa warning、Sol critical
const int   TEST_HR[CREW_COUNT]   = { 75,   55,   160,  72,    70   };
const float TEST_SPO2[CREW_COUNT] = { 98.0, 97.5, 91.0, 96.0,  95.5 };
const float TEST_TEMP[CREW_COUNT] = { 36.6, 36.8, 37.0, 37.55, 34.5 };
const int   TEST_SBP[CREW_COUNT]  = { 118,  112,  115,  125,   110  };
const int   TEST_DBP[CREW_COUNT]  = { 76,   72,   75,   85,    70   };
const int   TEST_RR[CREW_COUNT]   = { 16,   14,   18,   17,    8    };
const int   TEST_WOB[CREW_COUNT]  = { 2,    2,    3,    2,     4    };

// ---------------------------------------------------------------------
// ADS1115
// 只有 vitalsTask 會用 I2C
// ---------------------------------------------------------------------

// 單次轉換、AINx 對 GND、±4.096 V、128 SPS、關閉比較器
bool adsStart(uint8_t addr, uint8_t ch) {
  uint16_t cfg = 0x8000 | (uint16_t)((4 + ch) << 12) | 0x0200 | 0x0100 | 0x0080 | 0x0003;
  Wire.beginTransmission(addr);
  Wire.write(0x01);            // config register
  Wire.write(cfg >> 8);
  Wire.write(cfg & 0xFF);
  return Wire.endTransmission() == 0;
}

bool adsRead(uint8_t addr, float& frac) {
  Wire.beginTransmission(addr);
  Wire.write(0x00);            // conversion register
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)addr, 2) != 2) return false;
  uint8_t hi = Wire.read();
  uint8_t lo = Wire.read();
  int16_t raw = (int16_t)((hi << 8) | lo);
  frac = (float)raw / 26400.0f;    // 3.3 V ≈ 26400
  if (frac < 0.0f) frac = 0.0f;
  if (frac > 1.0f) frac = 1.0f;
  return true;
}

// 兩顆晶片同時轉換，4 個通道輪一次
void readAllPots() {
  static bool lastAlive[2] = { false, false };
  static bool firstTime = true;

  float frac[POT_COUNT] = { 0 };
  bool  ok[2] = { true, true };

  for (int ch = 0; ch < 4; ch++) {
    for (int d = 0; d < 2; d++) {
      if (ok[d]) ok[d] = adsStart(ADS_ADDR[d], ch);
    }
    if (!ok[0] && !ok[1]) break;
    vTaskDelay(pdMS_TO_TICKS(ADS_CONVERSION_MS));
    for (int d = 0; d < 2; d++) {
      if (ok[d]) ok[d] = adsRead(ADS_ADDR[d], frac[d * 4 + ch]);
    }
  }

  xSemaphoreTake(dataMutex, portMAX_DELAY);
  for (int d = 0; d < 2; d++) {
    adsAlive[d] = ok[d];
    if (ok[d]) {
      for (int ch = 0; ch < 4; ch++) potFrac[d * 4 + ch] = frac[d * 4 + ch];
    }
  }
  xSemaphoreGive(dataMutex);

  // 狀態有變才印
  for (int d = 0; d < 2; d++) {
    if (firstTime || ok[d] != lastAlive[d]) {
      logPrintf("[ADS] 0x%02X %s\n", ADS_ADDR[d],
                ok[d] ? "ok, using pots" : "no response, using fallback data");
      lastAlive[d] = ok[d];
    }
  }
  firstTime = false;
}

// -1 ~ +1
float randomUnit() {
  return ((float)(esp_random() & 0xFFFF) / 32767.5f) - 1.0f;
}

bool readPot(int k, float& value) {
  xSemaphoreTake(dataMutex, portMAX_DELAY);
  bool alive = adsAlive[k / 4];
  float f = potFrac[k];
  xSemaphoreGive(dataMutex);
  if (!alive) return false;

  float v = POT_LO[k] + (POT_HI[k] - POT_LO[k]) * f;
  if (ADD_POT_NOISE) v += POT_NOISE[k] * randomUnit();
  if (v < POT_LO[k]) v = POT_LO[k];
  if (v > POT_HI[k]) v = POT_HI[k];
  value = v;
  return true;
}

// IMU 滑桿分三段
// TODO: 目前只印出來，還沒放進封包
const char* imuStateText() {
  float f;
  xSemaphoreTake(dataMutex, portMAX_DELAY);
  bool alive = adsAlive[1];
  f = potFrac[POT_IMU];
  xSemaphoreGive(dataMutex);
  if (!alive)    return "(none)";
  if (f < 0.33f) return "rest / supine";
  if (f < 0.66f) return "rest / upright";
  return "active / upright";
}

// ---------------------------------------------------------------------
// 讀值
// Mira：滑桿優先，沒接的項目用播放資料
// 其他人：播放資料或固定值
// ---------------------------------------------------------------------

int playbackSecond() {
  if (!playbackStarted) return 0;
  return (int)(((millis() - playbackStartMs) / 1000) % PLAYBACK_SECONDS);
}

SampleQuality qualityFromBits(uint8_t bits) {
  if (bits == 1) return Q_POOR;
  if (bits == 2) return Q_MISSING;
  return Q_GOOD;
}

void readFallbackVitals(int crewIndex, VitalsSample& s) {
  if (USE_PLAYBACK) {
    int sec = playbackSecond();
    const PlaybackRow& r = PLAYBACK[crewIndex][sec];
    s.heartRate   = r.hr;
    s.spo2        = r.spo2x10 / 10.0f;
    s.hrQuality   = qualityFromBits(r.flags & 0x03);
    s.spo2Quality = qualityFromBits((r.flags >> 2) & 0x03);
    s.exercising  = (r.flags & 0x10) != 0;

    // 體溫、血壓每分鐘一筆
    int idx = sec / TEMP_BP_EVERY_SEC;
    const TempBpRow& t = TEMPBP[crewIndex][idx];
    s.temperature = t.tempx10 / 10.0f;
    s.systolicBP  = t.sbp;
    s.diastolicBP = t.dbp;
    s.tempBpIndex = idx;
  } else {
    s.heartRate   = TEST_HR[crewIndex];
    s.spo2        = TEST_SPO2[crewIndex];
    s.hrQuality   = Q_GOOD;
    s.spo2Quality = Q_GOOD;
    s.exercising  = false;
    s.temperature = TEST_TEMP[crewIndex];
    s.systolicBP  = TEST_SBP[crewIndex];
    s.diastolicBP = TEST_DBP[crewIndex];
    s.tempBpIndex = -1;
  }
}

void readVitals(int crewIndex, VitalsSample& s) {
  readFallbackVitals(crewIndex, s);
  if (crewIndex != CIRCUIT_CREW_INDEX) return;

  float v;
  bool potTempBp = false;
  if (readPot(POT_HR, v))   { s.heartRate = (int)lroundf(v); s.hrQuality = Q_GOOD; s.exercising = false; }
  if (readPot(POT_SPO2, v)) { s.spo2 = v; s.spo2Quality = Q_GOOD; }
  if (readPot(POT_TEMP, v)) { s.temperature = v;                 potTempBp = true; }
  if (readPot(POT_SBP, v))  { s.systolicBP  = (int)lroundf(v);   potTempBp = true; }
  if (readPot(POT_DBP, v))  { s.diastolicBP = (int)lroundf(v);   potTempBp = true; }
  if (potTempBp) s.tempBpIndex = -1;
}

int readRespiratoryRate(int crewIndex) {
  float v;
  if (crewIndex == CIRCUIT_CREW_INDEX && readPot(POT_RR, v)) return (int)lroundf(v);
  if (USE_PLAYBACK) return PLAYBACK[crewIndex][playbackSecond()].rr;
  return TEST_RR[crewIndex];
}

// TODO: 呼吸費力的量表還沒定，封包裡先送 missing
int readWorkOfBreathing(int crewIndex) {
  return TEST_WOB[crewIndex];
}

// ---------------------------------------------------------------------
// 判斷
// ---------------------------------------------------------------------

AlertLevel judgeTwoSided(float value, float critLow, float warnLow,
                         float warnHigh, float critHigh) {
  if (value < critLow || value >= critHigh) {
    return ALERT_CRITICAL;
  } else if (value < warnLow || value > warnHigh) {
    return ALERT_WARNING;
  } else {
    return ALERT_NORMAL;
  }
}

AlertLevel judgeLowOnly(float value, float critLow, float warnLow) {
  if (value < critLow) {
    return ALERT_CRITICAL;
  } else if (value < warnLow) {
    return ALERT_WARNING;
  } else {
    return ALERT_NORMAL;
  }
}

AlertLevel worse(AlertLevel a, AlertLevel b) {
  return (a > b) ? a : b;
}

void updateOverall(CrewMember& c) {
  AlertLevel overall = ALERT_NORMAL;
  overall = worse(overall, c.hrAlert);
  overall = worse(overall, c.spo2Alert);
  overall = worse(overall, c.tempAlert);
  overall = worse(overall, c.sbpAlert);
  overall = worse(overall, c.dbpAlert);
  overall = worse(overall, c.rrAlert);
  c.overallAlert = overall;
}

// ---------------------------------------------------------------------
// Serial (多個任務共用，要加鎖)
// ---------------------------------------------------------------------
void logPrintf(const char* format, ...) {
  char buf[320];
  va_list args;
  va_start(args, format);
  vsnprintf(buf, sizeof(buf), format, args);
  va_end(args);

  xSemaphoreTake(serialMutex, portMAX_DELAY);
  Serial.print(buf);
  xSemaphoreGive(serialMutex);
}

void logLine(const String& text) {
  xSemaphoreTake(serialMutex, portMAX_DELAY);
  Serial.println(text);
  xSemaphoreGive(serialMutex);
}

// ---------------------------------------------------------------------
// 網路、時間
// ---------------------------------------------------------------------
bool isClockSynced() {
  return time(nullptr) >= VALID_TIME_AFTER;
}

bool waitForWiFi(unsigned long timeoutMs) {
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - start > timeoutMs) {
      return false;
    }
    vTaskDelay(pdMS_TO_TICKS(250));
  }
  return true;
}

bool ensureWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return true;
  }

  logPrintf("[WiFi] connecting to %s\n", WIFI_SSID);
  if (!waitForWiFi(WIFI_TIMEOUT_MS)) {
    logPrintf("[WiFi] timeout, retrying\n");
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD, WIFI_CHANNEL);
    if (!waitForWiFi(WIFI_TIMEOUT_MS)) {
      logPrintf("[WiFi] failed, will retry later\n");
      return false;
    }
  }
  logPrintf("[WiFi] connected, IP %s\n", WiFi.localIP().toString().c_str());
  return true;
}

// 例：2026-11-14T02:00:00.123Z
void nowIso8601(char* out, size_t size) {
  struct timeval tv;
  gettimeofday(&tv, nullptr);

  struct tm t;
  gmtime_r(&tv.tv_sec, &t);

  char base[24];
  strftime(base, sizeof(base), "%Y-%m-%dT%H:%M:%S", &t);
  snprintf(out, size, "%s.%03ldZ", base, (long)(tv.tv_usec / 1000));
}

String makeBootId() {
  uint32_t r = esp_random();
  char buf[16];
  snprintf(buf, sizeof(buf), "boot-%08lx", (unsigned long)r);
  return String(buf);
}

bool tokenMissing(const char* token) {
  return token == nullptr || token[0] == '\0' || strncmp(token, "PASTE-", 6) == 0;
}

// ---------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------
String q(const char* text) {
  return String("\"") + text + "\"";
}

const char* qualityToText(SampleQuality qual) {
  switch (qual) {
    case Q_POOR:    return "poor";
    case Q_MISSING: return "missing";
    default:        return "good";
  }
}

const char* qualityReasonText(SampleQuality qual) {
  switch (qual) {
    case Q_POOR:    return "motion_artifact";
    case Q_MISSING: return "no_sample";
    default:        return nullptr;
  }
}

// missing：value 為 null，不放 deviceAlert
// poor   ：照常判斷，加上 qualityReason
String buildMetric(const char* code, String value, const char* unit,
                   const char* contextFields, AlertLevel alert, String groupId,
                   SampleQuality qual) {
  String m = "{";
  m += "\"code\":" + q(code) + ",";
  m += "\"value\":" + (qual == Q_MISSING ? String("null") : value) + ",";
  m += "\"unit\":" + q(unit) + ",";
  m += "\"method\":" + q(METRIC_METHOD) + ",";
  m += "\"context\":{";
  m += contextFields;
  if (qual != Q_MISSING) {
    m += ",\"deviceAlert\":" + q(alertToText(alert));
  }
  m += "},";
  if (groupId.length() > 0) {
    m += "\"measurementGroupId\":" + q(groupId.c_str()) + ",";
  }
  m += "\"quality\":" + q(qualityToText(qual));
  const char* reason = qualityReasonText(qual);
  if (reason != nullptr) {
    m += ",\"qualityReason\":" + q(reason);
  }
  m += "}";
  return m;
}

// TODO: 量表確定後改成完整的 work_of_breathing 物件
String buildWorkOfBreathingMissing() {
  String m = "{";
  m += "\"code\":\"work_of_breathing\",";
  m += "\"value\":null,";
  m += "\"unit\":" + q(UNIT_WOB) + ",";
  m += "\"method\":" + q(METRIC_METHOD) + ",";
  m += "\"context\":{},";
  m += "\"quality\":\"missing\",";
  m += "\"qualityReason\":\"scale_not_configured\"";
  m += "}";
  return m;
}

// deviceId:bootId:seq
String makeMessageId(const CrewMember& c) {
  return String(c.deviceId) + ":" + bootId + ":" + String(c.seq);
}

// c 是快照，組 JSON 時不用拿著鎖
String buildPacketJson(const CrewMember& c, bool includeTempBp) {
  String messageId = makeMessageId(c);
  String bpGroupId = messageId + ":bp";

  String rrContext = String("\"observationDuration\":") + RR_OBSERVATION_SEC;

  String json;
  json.reserve(2200);

  json += "{";
  json += "\"schemaVersion\":" + q(SCHEMA_VERSION) + ",";
  json += "\"messageId\":" + q(messageId.c_str()) + ",";
  json += "\"runId\":null,";
  json += "\"deviceId\":" + q(c.deviceId) + ",";
  json += "\"assignmentId\":" + q(c.assignmentId) + ",";
  json += "\"bootId\":" + q(bootId.c_str()) + ",";
  json += "\"seq\":" + String(c.seq) + ",";
  json += "\"observedAt\":" + q(c.observedAt) + ",";
  json += "\"deviceUptimeMs\":" + String(c.observedUptimeMs) + ",";
  json += "\"clockStatus\":" + q(c.observedClockSynced ? "synced" : "unsynced") + ",";
  json += "\"mode\":\"training\",";
  json += "\"source\":\"mock\",";
  json += "\"dataOrigin\":\"synthetic\",";
  json += "\"transport\":\"http\",";
  json += "\"isSynthetic\":true,";
  json += "\"upstreamSampleId\":" + q(messageId.c_str()) + ",";
  json += "\"deliveryKind\":\"live\",";

  json += "\"metrics\":[";
  json += buildMetric("heart_rate", String(c.heartRate), UNIT_HR,
                      c.exercising ? "\"activity\":\"exercise\"" : "\"activity\":\"rest\"",
                      c.hrAlert, "", c.hrQuality);
  json += ",";
  json += buildMetric("spo2", String(c.spo2, 1), UNIT_SPO2,
                      "\"measurementSite\":\"finger\"", c.spo2Alert, "", c.spo2Quality);
  if (includeTempBp) {
    json += ",";
    json += buildMetric("temperature", String(c.temperature, 2), UNIT_TEMP,
                        "\"measurementSite\":\"oral\",\"temperatureType\":\"oral\",\"sensor\":\"TMP117\"",
                        c.tempAlert, "", Q_GOOD);
    json += ",";
    json += buildMetric("blood_pressure_systolic", String(c.systolicBP), UNIT_BP,
                        "\"posture\":\"seated\"", c.sbpAlert, bpGroupId, Q_GOOD);
    json += ",";
    json += buildMetric("blood_pressure_diastolic", String(c.diastolicBP), UNIT_BP,
                        "\"posture\":\"seated\"", c.dbpAlert, bpGroupId, Q_GOOD);
  }
  if (c.hasRespiration) {
    json += ",";
    json += buildMetric("respiratory_rate", String(c.respiratoryRate), UNIT_RR,
                        rrContext.c_str(), c.rrAlert, "", Q_GOOD);
  }
  json += ",";
  json += buildWorkOfBreathingMissing();
  json += "]";

  json += "}";
  return json;
}

// ---------------------------------------------------------------------
// 傳送
// ---------------------------------------------------------------------
const bool USE_HTTPS = (strncmp(SERVER_URL, "https://", 8) == 0);

bool isRetryable(int code) {
  return code < 0 || code == 408 || code == 429 ||
         code == 500 || code == 502 || code == 503 || code == 504;
}

const char* explainError(int code) {
  switch (code) {
    case 400: return "bad JSON";
    case 401: return "bad token";
    case 403: return "token / deviceId / assignmentId mismatch";
    case 404: return "wrong URL";
    case 409: return "seq conflict or clock not synced";
    case 413: return "packet too large";
    case 422: return "validation failed";
    default:  return "error";
  }
}

// 去掉空白再比對
bool bodyHas(String body, const char* text) {
  body.replace(" ", "");
  body.replace("\n", "");
  return body.indexOf(text) >= 0;
}

// 重送時用同一份 json，seq 不變
bool sendPacket(const char* name, const char* token, const String& json,
                unsigned long seq) {
  for (int attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    WiFiClient       plainClient;
    WiFiClientSecure secureClient;
    WiFiClient* client = &plainClient;
    if (USE_HTTPS) {
      if (VERIFY_SERVER_CERT) {
        secureClient.setCACert(ROOT_CA);
      } else {
        // TODO: 不驗證憑證，只在 demo 用
        secureClient.setInsecure();
      }
      client = &secureClient;
    }

    HTTPClient http;
    http.setConnectTimeout(HTTP_TIMEOUT_MS);
    http.setTimeout(HTTP_TIMEOUT_MS);
    http.begin(*client, SERVER_URL);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("Authorization", String("Bearer ") + token);
    http.addHeader("ngrok-skip-browser-warning", "1");

    unsigned long t0 = millis();
    int code = http.POST(json);
    unsigned long elapsed = millis() - t0;
    String body = (code > 0) ? http.getString() : "";
    http.end();

    // 201 accepted = 新封包；200 replayed = 後端已經收過
    if (code == 201 && bodyHas(body, "\"status\":\"accepted\"")) {
      logPrintf("  [%s] 201 accepted  seq=%lu  %lu ms  (try %d)\n",
                name, seq, elapsed, attempt);
      return true;
    }
    if (code == 200 && bodyHas(body, "\"replayed\":true")) {
      logPrintf("  [%s] 200 replayed  seq=%lu  %lu ms  (try %d)\n",
                name, seq, elapsed, attempt);
      return true;
    }

    if (code < 0) {
      logPrintf("  [%s] connection failed: %s  seq=%lu  %lu ms  (try %d)\n",
                name, HTTPClient::errorToString(code).c_str(), seq, elapsed, attempt);
      if (USE_HTTPS) {
        char tlsErr[120];
        int tlsCode = secureClient.lastError(tlsErr, sizeof(tlsErr));
        logPrintf("    TLS error %d: %s\n", tlsCode, tlsErr);
      }
    } else {
      logPrintf("  [%s] HTTP %d %s  seq=%lu  (try %d)\n    %s\n",
                name, code, (code >= 200 && code < 300) ? "unexpected response" : explainError(code),
                seq, attempt, body.substring(0, 200).c_str());
    }

    if (!isRetryable(code)) {
      return false;
    }
    if (attempt < MAX_ATTEMPTS) {
      vTaskDelay(pdMS_TO_TICKS(RETRY_DELAYS_MS[attempt - 1]));
    }
  }

  // TODO: 失敗的封包先丟掉，之後可以存起來補傳
  logPrintf("  [%s] failed after %d tries, dropping seq=%lu\n", name, MAX_ATTEMPTS, seq);
  return false;
}

// ---------------------------------------------------------------------
// 狀態摘要 (每 10 秒)
// ---------------------------------------------------------------------
void printStatus() {
  CrewMember snap[CREW_COUNT];
  bool potsOk[2];
  float ecgFrac;

  xSemaphoreTake(dataMutex, portMAX_DELAY);
  for (int i = 0; i < CREW_COUNT; i++) snap[i] = crew[i];
  potsOk[0] = adsAlive[0];
  potsOk[1] = adsAlive[1];
  ecgFrac   = potFrac[POT_ECG];
  xSemaphoreGive(dataMutex);

  logPrintf("\n---- %lu s | vitals %lu, secondary %lu | sent %lu, failed %lu, skipped %lu | WiFi %s | clock %s ----\n",
            millis() / 1000, vitalsCount, secondaryCount, sentOkCount, sentFailCount,
            skippedCount, WiFi.status() == WL_CONNECTED ? "ok" : "down",
            isClockSynced() ? "synced" : "unsynced");

  if (USE_PLAYBACK) {
    int sec = playbackSecond();
    logPrintf("playback %02d:%02d / %02d:00%s\n", sec / 60, sec % 60,
              PLAYBACK_SECONDS / 60, playbackStarted ? "" : " (waiting)");
  } else {
    logPrintf("data: fixed test values\n");
  }

  for (int i = 0; i < CREW_COUNT; i++) {
    const CrewMember& c = snap[i];
    char hrText[24], spo2Text[24];
    if (c.hrQuality == Q_MISSING) snprintf(hrText, sizeof(hrText), "-- (missing)");
    else snprintf(hrText, sizeof(hrText), "%d%s", c.heartRate, c.hrQuality == Q_POOR ? " (poor)" : "");
    if (c.spo2Quality == Q_MISSING) snprintf(spo2Text, sizeof(spo2Text), "-- (missing)");
    else snprintf(spo2Text, sizeof(spo2Text), "%.1f%s", c.spo2, c.spo2Quality == Q_POOR ? " (poor)" : "");

    logPrintf("%-4s %-8s HR %s%s | SpO2 %s | T %.2f | BP %d/%d | RR %d%s\n",
              c.name, alertToText(c.overallAlert), hrText, c.exercising ? " (exercise)" : "",
              spo2Text, c.temperature, c.systolicBP, c.diastolicBP, c.respiratoryRate,
              i == CIRCUIT_CREW_INDEX ? "  [pots]" : "");
  }

  if (potsOk[0]) {
    float ecgHr = POT_LO[POT_ECG] + (POT_HI[POT_ECG] - POT_LO[POT_ECG]) * ecgFrac;
    logPrintf("  0x49 ok, ECG HR %.0f (not sent)\n", ecgHr);
  } else {
    logPrintf("  0x49 none\n");
  }
  logPrintf("  0x4A %s, IMU %s\n\n", potsOk[1] ? "ok" : "none", imuStateText());
}

// ---------------------------------------------------------------------
// vitalsTask：每 0.5 秒讀心率、血氧、體溫、血壓並判斷
// ---------------------------------------------------------------------
void vitalsTask(void* pvParameters) {
  while (true) {
    readAllPots();

    for (int i = 0; i < CREW_COUNT; i++) {
      VitalsSample v;
      readVitals(i, v);

      char  timeText[32];
      nowIso8601(timeText, sizeof(timeText));
      bool  synced = isClockSynced();
      unsigned long uptime = millis();

      xSemaphoreTake(dataMutex, portMAX_DELAY);
      CrewMember& c = crew[i];
      c.heartRate   = v.heartRate;
      c.spo2        = v.spo2;
      c.hrQuality   = v.hrQuality;
      c.spo2Quality = v.spo2Quality;
      c.exercising  = v.exercising;
      c.temperature = v.temperature;
      c.systolicBP  = v.systolicBP;
      c.diastolicBP = v.diastolicBP;
      c.tempBpIndex = v.tempBpIndex;
      strncpy(c.observedAt, timeText, sizeof(c.observedAt));
      c.observedUptimeMs    = uptime;
      c.observedClockSynced = synced;

      // missing 不判斷
      c.hrAlert   = (v.hrQuality == Q_MISSING) ? ALERT_NORMAL :
                    judgeTwoSided(v.heartRate, HR_CRIT_LOW, HR_WARN_LOW, HR_WARN_HIGH, HR_CRIT_HIGH);
      c.spo2Alert = (v.spo2Quality == Q_MISSING) ? ALERT_NORMAL :
                    judgeLowOnly(v.spo2, SPO2_CRIT_LOW, SPO2_WARN_LOW);
      c.tempAlert = judgeTwoSided(v.temperature, TEMP_CRIT_LOW, TEMP_WARN_LOW, TEMP_WARN_HIGH, TEMP_CRIT_HIGH);
      c.sbpAlert  = judgeTwoSided(v.systolicBP,  SBP_CRIT_LOW,  SBP_WARN_LOW,  SBP_WARN_HIGH,  SBP_CRIT_HIGH);
      c.dbpAlert  = judgeTwoSided(v.diastolicBP, DBP_CRIT_LOW,  DBP_WARN_LOW,  DBP_WARN_HIGH,  DBP_CRIT_HIGH);
      updateOverall(c);
      c.hasVitals = true;
      xSemaphoreGive(dataMutex);
    }

    vitalsCount++;
    vTaskDelay(pdMS_TO_TICKS(VITALS_PERIOD_MS));
  }
}

// ---------------------------------------------------------------------
// secondaryTask：每 2 秒讀呼吸，每 10 秒印狀態
// ---------------------------------------------------------------------
void secondaryTask(void* pvParameters) {
  unsigned long lastStatusMs = 0;

  while (true) {
    for (int i = 0; i < CREW_COUNT; i++) {
      int rr  = readRespiratoryRate(i);
      int wob = readWorkOfBreathing(i);

      xSemaphoreTake(dataMutex, portMAX_DELAY);
      CrewMember& c = crew[i];
      c.respiratoryRate = rr;
      c.workOfBreathing = wob;
      c.rrAlert = judgeTwoSided(rr, RR_CRIT_LOW, RR_WARN_LOW, RR_WARN_HIGH, RR_CRIT_HIGH);
      c.hasRespiration = true;
      updateOverall(c);
      xSemaphoreGive(dataMutex);
    }
    secondaryCount++;

    if (millis() - lastStatusMs >= STATUS_PRINT_INTERVAL_MS) {
      lastStatusMs = millis();
      printStatus();
    }

    vTaskDelay(pdMS_TO_TICKS(SECONDARY_PERIOD_MS));
  }
}

// ---------------------------------------------------------------------
// transmitTask：五個人輪流送
// ---------------------------------------------------------------------
void transmitTask(void* pvParameters) {
  int next = 0;

  // 上次送出的體溫/血壓是第幾分鐘的，-2 = 還沒送過
  int lastSentTempBp[CREW_COUNT];
  for (int i = 0; i < CREW_COUNT; i++) lastSentTempBp[i] = -2;

  while (true) {
    if (!ensureWiFi()) {
      vTaskDelay(pdMS_TO_TICKS(2000));
      continue;
    }

    // 後端不收 unsynced 的時間
    if (!isClockSynced()) {
      logPrintf("[NTP] waiting for time sync\n");
      vTaskDelay(pdMS_TO_TICKS(1000));
      continue;
    }

    if (!playbackStarted) {
      playbackStartMs = millis();
      playbackStarted = true;
      if (USE_PLAYBACK) logPrintf("[playback] start, %d min loop\n", PLAYBACK_SECONDS / 60);
    }

    if (tokenMissing(DEVICE_TOKENS[next])) {
      skippedCount++;
      next = (next + 1) % CREW_COUNT;
      vTaskDelay(pdMS_TO_TICKS(50));
      continue;
    }

    CrewMember snap;
    bool ready;
    xSemaphoreTake(dataMutex, portMAX_DELAY);
    CrewMember& c = crew[next];
    ready = c.hasVitals && c.observedClockSynced;
    if (ready) {
      c.seq++;
      snap = c;
    }
    xSemaphoreGive(dataMutex);

    if (ready) {
      // 播放資料的體溫/血壓一分鐘才更新一次，有新的才送
      bool includeTempBp = (snap.tempBpIndex < 0) || (snap.tempBpIndex != lastSentTempBp[next]);
      String json = buildPacketJson(snap, includeTempBp);
      if (PRINT_FULL_JSON) {
        logLine(json);
      }
      bool ok = sendPacket(snap.name, DEVICE_TOKENS[next], json, snap.seq);
      if (ok) {
        sentOkCount++;
        if (includeTempBp) lastSentTempBp[next] = snap.tempBpIndex;
      } else {
        sentFailCount++;
      }
    }

    next = (next + 1) % CREW_COUNT;
    vTaskDelay(pdMS_TO_TICKS(SEND_GAP_MS));
  }
}

// ---------------------------------------------------------------------
// setup / loop
// ---------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println("=== Astro Hiyoko telemetry gateway ===");

  dataMutex   = xSemaphoreCreateMutex();
  serialMutex = xSemaphoreCreateMutex();

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD, WIFI_CHANNEL);

  configTime(0, 0, NTP_SERVER_1, NTP_SERVER_2, NTP_SERVER_3);

  bootId = makeBootId();
  Serial.printf("bootId: %s\n", bootId.c_str());
  Serial.printf("server: %s (%s)\n", SERVER_URL, USE_HTTPS ? "https" : "http");
  Serial.printf("pots  : %s\n", crew[CIRCUIT_CREW_INDEX].name);
  Serial.printf("others: %s\n", USE_PLAYBACK ? "dataset-v2 playback" : "fixed test values");

  // 只印有沒有貼，不印 Token 內容
  Serial.print("token : ");
  for (int i = 0; i < CREW_COUNT; i++) {
    Serial.printf("%s %s%s", crew[i].name, tokenMissing(DEVICE_TOKENS[i]) ? "missing" : "ok",
                  (i < CREW_COUNT - 1) ? ", " : "\n");
  }
  Serial.println();

  xTaskCreate(vitalsTask,    "vitals",    VITALS_STACK,    NULL, VITALS_PRIORITY,    NULL);
  xTaskCreate(secondaryTask, "secondary", SECONDARY_STACK, NULL, SECONDARY_PRIORITY, NULL);
  xTaskCreate(transmitTask,  "transmit",  TRANSMIT_STACK,  NULL, TRANSMIT_PRIORITY,  NULL);
}

void loop() {
  vTaskDelay(portMAX_DELAY);
}
