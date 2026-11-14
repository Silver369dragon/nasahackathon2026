"""Version 1.3 measurement dictionary for the local training workspace."""

from typing import Any

_SOURCES = {
    "M": ("manual",),
    "S": ("mock", "scenario"),
    "H": ("hardware",),
    "F": ("wokwi",),
    "R": ("replay",),
}
_CATEGORIES = {"E": "emergency", "D": "daily", "L": "long_term"}
_CORE = {"heart_rate", "spo2", "blood_pressure", "temperature", "respiratory_rate", "work_of_breathing"}


def field(name: str, data_type: str, units: str = "", **metadata: Any) -> dict[str, Any]:
    definition = {"name": name, "dataType": data_type, **metadata}
    if units:
        definition["allowedUnits"] = units.split("|")
    return definition


def _metric(
    identifier: str, code: str, label: str, english: str, data_type: str,
    sources: str, fields: list[dict[str, Any]], *, unit: str | None = None,
    context: tuple[str, ...] = (), trends: tuple[str, ...] = (),
    precision: int | None = None, display_unit: str | None = None,
    alternative_types: tuple[str, ...] = (),
) -> dict[str, Any]:
    units = [unit] if unit else []
    for item in fields:
        units.extend(item.get("allowedUnits", []))
    return {
        "id": identifier, "code": code, "label": label, "labelEn": english,
        "category": _CATEGORIES[identifier[0]], "dataType": data_type,
        "acceptedDataTypes": [data_type, *alternative_types],
        "unit": unit, "allowedUnits": list(dict.fromkeys(units)),
        "displayUnit": display_unit or unit, "displayPrecision": precision,
        "sourceOptions": [source for key in sources for source in _SOURCES[key]],
        "enabled": code in _CORE, "requiredContext": list(context),
        **({"assessmentForm": "news2"} if code in ("respiratory_rate","neurological_assessment") else {}),
        "formSchema": fields, "numericTrendFields": list(trends),
        "schemaVersion": "1.3",
    }


CATALOG = [
    _metric("E01", "spo2", "血氧飽和度", "Oxygen saturation", "number", "MSHFR", [
        field("value", "number", "%", minimum=0, maximum=100),
        field("measurementSite", "coded"), field("oxygenScale", "coded"),
    ], unit="%", precision=0, context=("measurementSite",), trends=("value",)),
    _metric("E02", "heart_rate", "心率", "Heart rate", "number", "MSHFR", [
        field("value", "number", "/min"), field("activity", "coded"),
    ], unit="/min", display_unit="bpm", precision=0, context=("activity",), trends=("value",)),
    _metric("E03", "ecg", "心電圖", "Electrocardiogram", "series", "MSHR", [
        field("samples", "number[]", "mV"), field("sampleRate", "number", "Hz"),
        field("timeOffsets", "number[]", "ms"), field("startTime", "datetime"),
        field("lead", "coded"), field("calibration", "record"), field("signalQuality", "coded"),
        field("observation", "coded/text"), field("attachmentId", "attachment"),
        field("attachmentHash", "text"),
    ], alternative_types=("attachment",)),
    _metric("E04", "blood_pressure", "血壓", "Blood pressure", "record", "MSHFR", [
        field("systolic", "number", "mm[Hg]", metricCode="blood_pressure_systolic"),
        field("diastolic", "number", "mm[Hg]", metricCode="blood_pressure_diastolic"),
        field("measurementGroupId", "text"), field("posture", "coded"),
    ], unit="mm[Hg]", display_unit="mmHg", precision=0, context=("posture",), trends=("systolic", "diastolic")),
    _metric("E05", "temperature", "體溫", "Body temperature", "number", "MSHFR", [
        field("value", "number", "Cel"), field("measurementSite", "coded"),
        field("temperatureType", "coded"),
    ], unit="Cel", display_unit="°C", precision=1, context=("measurementSite", "temperatureType"),
        trends=("value",)),
    _metric("E06", "respiratory_rate", "呼吸頻率", "Respiratory rate", "number", "MSHFR", [
        field("value", "number", "/min"), field("observationDuration", "number", "s"),
        field("pattern", "coded"),
    ], unit="/min", context=("observationDuration",), trends=("value",)),
    _metric("E07", "work_of_breathing", "呼吸費力程度", "Work of breathing", "record", "MS", [
        field("dyspnea", "coded"), field("accessoryMuscleUse", "boolean"),
        field("speakingAbility", "coded"), field("scaleId", "text"), field("scaleVersion", "text"),
        field("score", "number"), field("notes", "text"),
    ], unit="1"),
    _metric("E08", "symptom_assessment", "症狀評估", "Symptom assessment", "record[]", "MS", [
        field("symptom", "coded", examples=["chest_pain", "dyspnea", "headache", "dizziness", "nausea", "pain"]),
        field("onset", "datetime"), field("severity", "coded/number"),
        field("scaleId", "text"), field("scaleVersion", "text"), field("persistence", "coded"),
        field("notes", "text"),
    ]),
    _metric("E09", "neurological_assessment", "神經學評估", "Neurological assessment", "record", "MS", [
        field("avpu", "coded", options=["A", "V", "P", "U"]),
        field("newConfusion", "boolean", nullable=True), field("orientation", "coded/text"),
        field("pupilDiameter", "number", "mm"), field("pupilObservation", "text"),
        field("speech", "coded/text"), field("limbStrength", "coded/text"),
        field("scaleId", "text"), field("scaleVersion", "text"),
    ]),
    _metric("E10", "co2_concentration", "二氧化碳濃度", "Carbon dioxide concentration",
            "number", "MSHFR", [
        field("value", "number", "ppm"), field("exposureDuration", "number", "s"),
        field("startTime", "datetime"), field("endTime", "datetime"), field("cabinZone", "coded"),
    ], unit="ppm", context=("cabinZone",), trends=("value",)),
    _metric("E11", "ambient_oxygen", "艙內氧氣", "Ambient oxygen", "record", "MSHFR", [
        field("concentration", "number", "%", minimum=0, maximum=100),
        field("partialPressure", "number", "kPa"), field("cabinPressure", "number", "kPa"),
        field("cabinZone", "coded"), field("method", "coded"),
    ], context=("cabinZone",), trends=("concentration", "partialPressure")),
    _metric("E12", "cabin_pressure", "艙壓", "Cabin pressure", "number", "MSHFR", [
        field("value", "number", "kPa"), field("changeRate", "number", "kPa/min"),
        field("windowDuration", "number", "s"), field("cabinZone", "coded"),
        field("depressurization", "coded"),
    ], unit="kPa", context=("cabinZone",), trends=("value", "changeRate")),
    _metric("D01", "resting_heart_rate", "靜息心率", "Resting heart rate", "number", "MSHR", [
        field("value", "number", "/min"), field("restConditions", "record"),
        field("periodStart", "datetime"), field("periodEnd", "datetime"),
        field("sourceMeasurementIds", "text[]"),
    ], unit="/min", context=("restConditions",), trends=("value",)),
    _metric("D02", "hrv", "心率變異度", "Heart rate variability", "record", "MSHR", [
        field("rmssd", "number", "ms"), field("beatIntervals", "number[]", "ms"),
        field("intervalSource", "text"), field("analysisWindow", "number", "s"),
        field("analysisMethod", "coded"),
    ], trends=("rmssd",)),
    _metric("D03", "sleep", "睡眠紀錄", "Sleep", "record", "MSHR", [
        field("duration", "number", "min"), field("efficiency", "number", "%", minimum=0, maximum=100),
        field("interruptions", "integer"), field("subjectiveQuality", "coded"),
        field("scaleId", "text"), field("scaleVersion", "text"),
    ], trends=("duration", "efficiency", "interruptions")),
    _metric("D04", "pvt", "精神運動警覺測試", "Psychomotor vigilance test", "record", "MSR", [
        field("duration", "number", "s"), field("reactionTimes", "number[]", "ms"),
        field("lapses", "integer"), field("falseStarts", "integer"), field("testVersion", "text"),
    ], trends=("lapses", "falseStarts")),
    _metric("D05", "mood_stress", "情緒與壓力", "Mood and stress", "record", "MS", [
        field("mood", "coded/number"), field("stress", "coded/number"),
        field("loneliness", "coded/number"), field("concentration", "coded/number"),
        field("scaleId", "text"), field("scaleVersion", "text"), field("notes", "text"),
    ]),
    _metric("D06", "hydration", "飲水與排尿", "Hydration", "record", "MSH", [
        field("intake", "number", "mL"), field("urineColor", "coded"),
        field("voidCount", "integer"), field("observation", "text"),
    ], trends=("intake", "voidCount")),
    _metric("D07", "appetite_gi", "食慾與腸胃狀況", "Appetite and gastrointestinal health",
            "record", "MS", [
        field("appetite", "coded"), field("foodMass", "number", "g"), field("portion", "coded"),
        field("symptoms", "coded[]", examples=["nausea", "constipation", "diarrhea"]),
        field("mealTime", "datetime"),
    ], trends=("foodMass",)),
    _metric("D08", "pain_body_map", "疼痛部位", "Pain body map", "record[]", "MS", [
        field("bodySite", "coded"), field("laterality", "coded"), field("score", "number"),
        field("scaleId", "text"), field("scaleVersion", "text"), field("character", "coded/text"),
        field("functionalImpact", "coded/text"),
    ]),
    _metric("D09", "medication", "用藥紀錄", "Medication", "record[]", "MS", [
        field("medicationId", "text"), field("dose", "number", unitField="doseUnit"),
        field("doseUnit", "coded"), field("route", "coded"), field("scheduledTime", "datetime"),
        field("actualTime", "datetime"), field("status", "coded"), field("adverseEffects", "text"),
    ]),
    _metric("L01", "body_mass", "身體質量", "Body mass", "number", "MSHR", [
        field("value", "number", "kg"), field("gravityEnvironment", "coded"), field("method", "coded"),
    ], unit="kg", context=("gravityEnvironment",), trends=("value",)),
    _metric("L02", "grip_strength", "握力", "Grip strength", "record", "MSHR", [
        field("force", "number", "N|kgf", canonicalUnit="N"),
        field("laterality", "coded"), field("posture", "coded"), field("trial", "integer"),
    ], trends=("force",)),
    _metric("L03", "functional_movement", "功能性動作", "Functional movement", "record[]", "MSH", [
        field("movement", "coded", examples=["squat", "balance", "lunge"]), field("trial", "integer"),
        field("duration", "number", "s"), field("angle", "number", "deg"),
        field("score", "number"), field("scaleId", "text"), field("scaleVersion", "text"),
        field("assessor", "text"),
    ], trends=("duration", "angle")),
    _metric("L04", "exercise", "運動訓練", "Exercise", "record", "MSHR", [
        field("exerciseType", "coded"), field("duration", "number", "min"),
        field("sets", "integer"), field("repetitions", "integer"),
        field("load", "number", "kg|N|W", unitField="loadUnit"), field("loadUnit", "coded"),
        field("completion", "number", "%", minimum=0, maximum=100), field("recovery", "number", "min"),
    ], trends=("duration", "completion", "recovery")),
    _metric("L05", "orthostatic_assessment", "姿勢變化評估", "Orthostatic assessment", "record", "MSHR", [
        field("posture", "coded"), field("relativeTime", "number", "s"), field("heartRate", "number", "/min"),
        field("systolic", "number", "mm[Hg]"), field("diastolic", "number", "mm[Hg]"),
        field("symptoms", "coded[]"),
    ], trends=("heartRate", "systolic", "diastolic")),
    _metric("L06", "bone_assessment", "骨骼評估", "Bone assessment", "record", "MSHR", [
        field("arealBmd", "number", "g/cm²"), field("volumetricBmd", "number", "mg/cm³"),
        field("bmc", "number", "g"), field("boneStructure", "coded/text"),
        field("ultrasoundParameters", "record[]", preserveOriginalUnits=True),
        field("method", "coded"), field("attachmentId", "attachment"),
    ], alternative_types=("attachment",), trends=("arealBmd", "volumetricBmd", "bmc")),
    _metric("L07", "micronutrients", "微量營養素", "Micronutrients", "record[]", "MSR", [
        field("analyte", "coded", examples=["vitamin_D", "calcium", "vitamin_K", "B12", "iron", "magnesium", "potassium", "zinc"]),
        field("specimen", "coded"), field("value", "number", unitField="labUnit"),
        field("labUnit", "coded"), field("method", "coded"), field("referenceRange", "record"),
        field("laboratory", "text"),
    ]),
    _metric("L08", "electrolyte_balance", "電解質與水分平衡", "Electrolyte and fluid balance",
            "record", "MSHR", [
        field("sodiumIntake", "number", "mg/day"), field("electrolytes", "record[]", fields=[
            field("analyte", "coded"), field("specimen", "coded"),
            field("concentration", "number", unitField="labUnit"),
            field("labUnit", "coded", examples=["mmol/L"]), field("method", "coded"),
        ]), field("intake", "number", "mL"), field("output", "number", "mL"),
        field("periodStart", "datetime"), field("periodEnd", "datetime"),
    ], trends=("sodiumIntake", "intake", "output")),
    _metric("L09", "radiation", "輻射劑量", "Radiation", "record", "MSHR", [
        field("quantity", "coded"), field("dose", "number", "Gy|Sv", unitField="doseUnit"),
        field("doseUnit", "coded", options=["Gy", "Sv"]),
        field("doseRate", "number", "Gy/h|Sv/h"), field("countRate", "number", "count/s"),
        field("startTime", "datetime"), field("endTime", "datetime"), field("calibration", "record"),
        field("scope", "coded", options=["area", "personal", "space_weather"]),
        field("solarParticleEvent", "coded/text"), field("location", "coded"),
    ]),
    _metric("L10", "noise_exposure", "噪音暴露", "Noise exposure", "record", "MSHR", [
        field("level", "number", "dB"), field("frequencyWeighting", "coded"),
        field("timeWeighting", "coded"), field("duration", "number", "s"),
        field("cumulativeIndex", "number", unitField="indexUnit"), field("indexUnit", "coded"),
        field("algorithm", "text"), field("location", "coded"),
    ], trends=("level", "duration")),
    _metric("L11", "lighting_exposure", "照明暴露", "Lighting exposure", "record", "MSHR", [
        field("illuminance", "number", "lx"), field("colorTemperature", "number", "K"),
        field("wavelengths", "number[]", "nm"), field("intensities", "number[]", unitField="intensityUnit"),
        field("intensityUnit", "coded"), field("startTime", "datetime"), field("endTime", "datetime"),
        field("location", "coded"),
    ], trends=("illuminance", "colorTemperature")),
    _metric("L12", "humidity", "濕度與冷凝", "Humidity and condensation", "record", "MSHFR", [
        field("relativeHumidity", "number", "%RH", minimum=0, maximum=100),
        field("dewPoint", "number", "Cel"), field("condensation", "boolean/coded"), field("cabinZone", "coded"),
    ], context=("cabinZone",), trends=("relativeHumidity", "dewPoint")),
]
