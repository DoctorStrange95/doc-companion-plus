"""Drug Reference & Treatment Guide — FastAPI router."""

import csv
import io
import json
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from auth import get_current_user

router = APIRouter(prefix="/api/drug-reference", tags=["drug-reference"])


def _require_admin(user):
    if not user or getattr(user, "role", "") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")


# ── Schema ───────────────────────────────────────────────────────────────────

class ConditionIn(BaseModel):
    name: str
    aliases: List[str] = []
    category: str = ""
    icd_code: str = ""
    notes: str = ""


class DrugIn(BaseModel):
    generic_name: str
    brand_names: List[str] = []
    drug_class: str = ""
    category: str = ""


class RegimenIn(BaseModel):
    condition_id: str
    drug_id: str
    adult_dose: str = ""
    pediatric_dose: str = ""
    route: str = ""
    frequency: str = ""
    duration: str = ""
    strength: str = ""
    formulation: str = ""
    line_of_treatment: str = "First line"
    notes: str = ""
    contraindications: str = ""


class RegimenUpdate(BaseModel):
    adult_dose: Optional[str] = None
    pediatric_dose: Optional[str] = None
    route: Optional[str] = None
    frequency: Optional[str] = None
    duration: Optional[str] = None
    strength: Optional[str] = None
    formulation: Optional[str] = None
    line_of_treatment: Optional[str] = None
    notes: Optional[str] = None
    contraindications: Optional[str] = None


# ── Table creation ────────────────────────────────────────────────────────────

async def ensure_drug_reference_tables(engine):
    async with engine.begin() as conn:
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS dr_conditions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name TEXT NOT NULL,
                aliases JSONB NOT NULL DEFAULT '[]',
                category TEXT NOT NULL DEFAULT '',
                icd_code TEXT NOT NULL DEFAULT '',
                notes TEXT NOT NULL DEFAULT '',
                created_at TIMESTAMPTZ DEFAULT now(),
                updated_at TIMESTAMPTZ DEFAULT now()
            )
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS dr_drugs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                generic_name TEXT NOT NULL,
                brand_names JSONB NOT NULL DEFAULT '[]',
                drug_class TEXT NOT NULL DEFAULT '',
                category TEXT NOT NULL DEFAULT '',
                created_at TIMESTAMPTZ DEFAULT now(),
                updated_at TIMESTAMPTZ DEFAULT now()
            )
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS dr_regimens (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                condition_id UUID REFERENCES dr_conditions(id) ON DELETE CASCADE,
                drug_id UUID REFERENCES dr_drugs(id) ON DELETE CASCADE,
                adult_dose TEXT NOT NULL DEFAULT '',
                pediatric_dose TEXT NOT NULL DEFAULT '',
                route TEXT NOT NULL DEFAULT '',
                frequency TEXT NOT NULL DEFAULT '',
                duration TEXT NOT NULL DEFAULT '',
                strength TEXT NOT NULL DEFAULT '',
                formulation TEXT NOT NULL DEFAULT '',
                line_of_treatment TEXT NOT NULL DEFAULT 'First line',
                notes TEXT NOT NULL DEFAULT '',
                contraindications TEXT NOT NULL DEFAULT '',
                created_at TIMESTAMPTZ DEFAULT now(),
                updated_at TIMESTAMPTZ DEFAULT now()
            )
        """))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_drc_name ON dr_conditions(lower(name))"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_drd_generic ON dr_drugs(lower(generic_name))"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_drr_cond ON dr_regimens(condition_id)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_drr_drug ON dr_regimens(drug_id)"
        ))


# ── Seed data ─────────────────────────────────────────────────────────────────

SEED = [
    {
        "name": "Upper Respiratory Tract Infection",
        "aliases": ["URTI", "Cold", "Cough and Cold", "Common Cold"],
        "category": "Respiratory",
        "icd_code": "J06.9",
        "regimens": [
            {"drug": "Azithromycin", "brands": ["Azee", "Zithromax", "Azithral"], "cls": "Macrolide Antibiotic", "cat": "Antibiotic", "adult": "500 mg OD", "ped": "10 mg/kg/day OD", "route": "Oral", "freq": "OD", "dur": "3-5 days", "str": "500 mg", "form": "Tablet", "line": "First line", "notes": "Give after food"},
            {"drug": "Amoxicillin", "brands": ["Mox", "Novamox", "Amoxil"], "cls": "Penicillin Antibiotic", "cat": "Antibiotic", "adult": "500 mg TDS", "ped": "25 mg/kg/day in 3 divided doses", "route": "Oral", "freq": "TDS", "dur": "5 days", "str": "500 mg", "form": "Capsule", "line": "First line", "notes": "Alternative first line"},
            {"drug": "Levocetirizine + Montelukast", "brands": ["Montair LC", "Levocet M"], "cls": "Antihistamine + Leukotriene Antagonist", "cat": "Combination", "adult": "1 tab OD HS", "ped": "Paediatric formulation per weight", "route": "Oral", "freq": "OD", "dur": "7 days", "str": "5 mg + 10 mg", "form": "Tablet", "line": "Adjuvant", "notes": "Give at bedtime"},
            {"drug": "Paracetamol", "brands": ["Calpol", "Dolo", "Crocin"], "cls": "Analgesic / Antipyretic", "cat": "Analgesic", "adult": "650 mg TDS SOS", "ped": "15 mg/kg/dose 4-6 hrly SOS", "route": "Oral", "freq": "TDS", "dur": "5 days SOS", "str": "650 mg", "form": "Tablet", "line": "Adjuvant", "notes": "Only when fever/pain present"},
            {"drug": "Ambroxol + Guaifenesin + Salbutamol", "brands": ["Ascoril LS", "Grilinctus"], "cls": "Mucolytic + Expectorant + Bronchodilator", "cat": "Combination", "adult": "10 ml TDS", "ped": "5 ml TDS (<6 yr), 10 ml TDS (>6 yr)", "route": "Oral", "freq": "TDS", "dur": "5-7 days", "str": "Syrup", "form": "Syrup", "line": "Adjuvant", "notes": "Cough with mucus"},
            {"drug": "Omeprazole", "brands": ["Omez", "Ocid"], "cls": "Proton Pump Inhibitor", "cat": "GI", "adult": "20 mg OD BBF", "ped": "0.7-3.3 mg/kg/day", "route": "Oral", "freq": "OD", "dur": "5 days", "str": "20 mg", "form": "Capsule", "line": "Adjuvant", "notes": "Gastric cover with antibiotics"},
            {"drug": "Vitamin C", "brands": ["Celin", "Limcee"], "cls": "Vitamin / Antioxidant", "cat": "Supplement", "adult": "500 mg TDS", "ped": "100 mg OD", "route": "Oral", "freq": "TDS", "dur": "7 days", "str": "500 mg", "form": "Tablet", "line": "Adjuvant", "notes": "Immune support"},
        ],
    },
    {
        "name": "Type 2 Diabetes Mellitus",
        "aliases": ["T2DM", "Diabetes", "T2 Diabetes", "Sugar"],
        "category": "Endocrine",
        "icd_code": "E11",
        "regimens": [
            {"drug": "Metformin", "brands": ["Glycomet", "Glucophage", "Glyciphage"], "cls": "Biguanide", "cat": "Antidiabetic", "adult": "500 mg BD with meals (start); 1000 mg BD (escalated)", "ped": "Not first line <10 yr", "route": "Oral", "freq": "BD", "dur": "Continue", "str": "500 mg / 1000 mg", "form": "Tablet", "line": "First line", "notes": "Start low, increase over 4 weeks"},
            {"drug": "Glimepiride", "brands": ["Glim", "Amaryl", "Glucoryl"], "cls": "Sulfonylurea", "cat": "Antidiabetic", "adult": "1 mg OD BBF (start); 2 mg OD (escalated)", "ped": "Not recommended", "route": "Oral", "freq": "OD", "dur": "Continue", "str": "1 mg / 2 mg", "form": "Tablet", "line": "Second line", "notes": "Take before breakfast; risk of hypoglycaemia"},
            {"drug": "Dapagliflozin", "brands": ["Forxiga", "Dapaglu"], "cls": "SGLT2 Inhibitor", "cat": "Antidiabetic", "adult": "10 mg OD", "ped": "Not recommended <18 yr", "route": "Oral", "freq": "OD", "dur": "Continue", "str": "10 mg", "form": "Tablet", "line": "Second line", "notes": "Cardio-renal benefit; ensure good hydration"},
            {"drug": "Sitagliptin", "brands": ["Januvia", "Istavel"], "cls": "DPP-4 Inhibitor", "cat": "Antidiabetic", "adult": "100 mg OD", "ped": "Not approved", "route": "Oral", "freq": "OD", "dur": "Continue", "str": "100 mg", "form": "Tablet", "line": "Second line", "notes": "Low hypoglycaemia risk"},
            {"drug": "Vildagliptin", "brands": ["Galvus", "Zomelis"], "cls": "DPP-4 Inhibitor", "cat": "Antidiabetic", "adult": "50 mg BD", "ped": "Not approved", "route": "Oral", "freq": "BD", "dur": "Continue", "str": "50 mg", "form": "Tablet", "line": "Second line", "notes": "Alternative DPP4 inhibitor"},
            {"drug": "Gliclazide", "brands": ["Diamicron MR", "Glizid MR"], "cls": "Sulfonylurea (2nd gen)", "cat": "Antidiabetic", "adult": "60 mg OD MR BBF", "ped": "Not recommended", "route": "Oral", "freq": "OD", "dur": "Continue", "str": "60 mg MR", "form": "Tablet", "line": "Second line", "notes": "Modified release, fewer hypo episodes"},
            {"drug": "Atorvastatin", "brands": ["Lipitor", "Atorva", "Aztor"], "cls": "Statin", "cat": "Lipid-lowering", "adult": "10-20 mg HS", "ped": "Not routine <18 yr", "route": "Oral", "freq": "OD", "dur": "Continue", "str": "10 mg / 20 mg", "form": "Tablet", "line": "Adjuvant", "notes": "For dyslipidemia; take at night"},
            {"drug": "Vitamin B Complex", "brands": ["Becosules", "Neurobion Forte"], "cls": "Vitamin Supplement", "cat": "Supplement", "adult": "1 tab OD", "ped": "Appropriate paediatric dose", "route": "Oral", "freq": "OD", "dur": "Continue", "str": "Standard", "form": "Tablet", "line": "Adjuvant", "notes": "Prevent B12 deficiency with metformin"},
        ],
    },
    {
        "name": "Hypertension",
        "aliases": ["HTN", "High BP", "High Blood Pressure"],
        "category": "Cardiovascular",
        "icd_code": "I10",
        "regimens": [
            {"drug": "Telmisartan", "brands": ["Telma", "Telsartan", "Micardis"], "cls": "ARB", "cat": "Antihypertensive", "adult": "40 mg OD", "ped": "Not routine <6 yr", "route": "Oral", "freq": "OD", "dur": "Continue", "str": "40 mg", "form": "Tablet", "line": "First line", "notes": "Once daily; good 24-hr coverage"},
            {"drug": "Amlodipine", "brands": ["Amlip", "Norvasc", "Stamlo"], "cls": "Calcium Channel Blocker", "cat": "Antihypertensive", "adult": "5 mg OD", "ped": "0.1-0.3 mg/kg/day", "route": "Oral", "freq": "OD", "dur": "Continue", "str": "5 mg", "form": "Tablet", "line": "First line", "notes": "Can cause ankle oedema"},
            {"drug": "Telmisartan + Amlodipine", "brands": ["Telma AM", "Telsartan AM"], "cls": "ARB + CCB Combination", "cat": "Antihypertensive", "adult": "40/5 mg OD", "ped": "Not recommended", "route": "Oral", "freq": "OD", "dur": "Continue", "str": "40 mg + 5 mg", "form": "Tablet", "line": "First line", "notes": "Fixed-dose combination for better adherence"},
            {"drug": "Losartan", "brands": ["Losar", "Repace", "Cozaar"], "cls": "ARB", "cat": "Antihypertensive", "adult": "50 mg OD", "ped": ">6 yr: 0.7 mg/kg/day", "route": "Oral", "freq": "OD", "dur": "Continue", "str": "50 mg", "form": "Tablet", "line": "First line", "notes": "Alternative ARB; uricosuric effect"},
            {"drug": "Metoprolol", "brands": ["Met XL", "Metolar", "Lopressor"], "cls": "Beta-1 Blocker", "cat": "Antihypertensive", "adult": "50 mg BD (IR) or 25-50 mg OD (XL)", "ped": "1-2 mg/kg/day divided", "route": "Oral", "freq": "BD/OD", "dur": "Continue", "str": "50 mg", "form": "Tablet", "line": "Second line", "notes": "Do not stop abruptly"},
            {"drug": "Chlorthalidone", "brands": ["Hygroton"], "cls": "Thiazide-like Diuretic", "cat": "Antihypertensive", "adult": "12.5 mg OD", "ped": "0.3 mg/kg/day", "route": "Oral", "freq": "OD", "dur": "Continue", "str": "12.5 mg", "form": "Tablet", "line": "Second line", "notes": "Take in morning; monitor K+"},
        ],
    },
    {
        "name": "Hypothyroidism",
        "aliases": ["Low Thyroid", "Thyroid deficiency", "Underactive thyroid"],
        "category": "Endocrine",
        "icd_code": "E03.9",
        "regimens": [
            {"drug": "Levothyroxine", "brands": ["Thyronorm", "Eltroxin", "Thyrox"], "cls": "Thyroid Hormone", "cat": "Hormone Replacement", "adult": "25-50 mcg OD empty stomach (starting); titrate every 6 weeks", "ped": "Neonatal: 10-15 mcg/kg/day", "route": "Oral", "freq": "OD", "dur": "Lifelong", "str": "25 / 50 / 75 / 100 / 125 mcg", "form": "Tablet", "line": "First line", "notes": "Take 30-60 min before food; check TSH every 6 weeks until stable"},
        ],
    },
    {
        "name": "Acute Gastroenteritis",
        "aliases": ["AGE", "Diarrhea", "Loose motions", "Vomiting and diarrhea", "Gastro"],
        "category": "GI",
        "icd_code": "A09",
        "regimens": [
            {"drug": "ORS", "brands": ["Electral", "Pedialyte"], "cls": "Oral Rehydration Salt", "cat": "Rehydration", "adult": "2 sachets in 1 L water as needed", "ped": "50-100 ml/kg over 3-4 hrs for mild dehydration", "route": "Oral", "freq": "As needed", "dur": "Until diarrhea stops", "str": "WHO formula", "form": "Sachet", "line": "First line", "notes": "Cornerstone of treatment"},
            {"drug": "Ondansetron", "brands": ["Emeset", "Zofer", "Zofran"], "cls": "5-HT3 Antagonist", "cat": "Antiemetic", "adult": "4 mg BD", "ped": "0.15 mg/kg/dose up to 4 mg BD", "route": "Oral", "freq": "BD", "dur": "3 days", "str": "4 mg", "form": "Tablet", "line": "First line", "notes": "For vomiting; avoid in prolonged QT"},
            {"drug": "Norfloxacin + Tinidazole", "brands": ["Normet", "Nortinidazole"], "cls": "Fluoroquinolone + Nitroimidazole", "cat": "Antibiotic", "adult": "1 tab BD", "ped": "Not recommended <12 yr", "route": "Oral", "freq": "BD", "dur": "5 days", "str": "400 mg + 600 mg", "form": "Tablet", "line": "Second line", "notes": "Bacterial AGE; avoid if no indication"},
            {"drug": "Metronidazole", "brands": ["Flagyl", "Metrogyl", "Aldezole"], "cls": "Nitroimidazole", "cat": "Antibiotic", "adult": "400 mg TDS", "ped": "7.5 mg/kg/dose TDS", "route": "Oral", "freq": "TDS", "dur": "5 days", "str": "400 mg", "form": "Tablet", "line": "Second line", "notes": "Amoebic dysentery or Giardia"},
            {"drug": "Zinc", "brands": ["Zincovit", "Zinconia"], "cls": "Mineral Supplement", "cat": "Supplement", "adult": "20 mg OD", "ped": "10-20 mg OD (<5 yr: 10 mg)", "route": "Oral", "freq": "OD", "dur": "14 days", "str": "20 mg", "form": "Tablet/Syrup", "line": "Adjuvant", "notes": "Reduces severity and duration in children"},
            {"drug": "Saccharomyces boulardii", "brands": ["Econorm", "Reflor"], "cls": "Probiotic", "cat": "Probiotic", "adult": "1 sachet BD", "ped": "1 sachet OD-BD", "route": "Oral", "freq": "BD", "dur": "5-7 days", "str": "250 mg sachet", "form": "Sachet", "line": "Adjuvant", "notes": "Restore gut flora"},
        ],
    },
    {
        "name": "Wound / Laceration / Dog Bite",
        "aliases": ["Dog bite", "Animal bite", "Wound", "Laceration", "Cut"],
        "category": "Emergency",
        "icd_code": "T14.1",
        "regimens": [
            {"drug": "Tetanus Toxoid", "brands": ["TT Injection"], "cls": "Vaccine / Toxoid", "cat": "Prophylaxis", "adult": "0.5 ml IM Stat", "ped": "0.5 ml IM Stat", "route": "IM", "freq": "Stat", "dur": "Single dose (if unvaccinated / booster due)", "str": "0.5 ml", "form": "Injection", "line": "First line", "notes": "Always give for penetrating wounds"},
            {"drug": "Amoxicillin-Clavulanate", "brands": ["Augmentin", "Clavam", "Moxclav"], "cls": "Penicillin + Beta-lactamase Inhibitor", "cat": "Antibiotic", "adult": "625 mg BD", "ped": "25/6.25 mg/kg/day in 2 divided doses", "route": "Oral", "freq": "BD", "dur": "5-7 days", "str": "625 mg", "form": "Tablet", "line": "First line", "notes": "Drug of choice for dog/cat bite infections"},
            {"drug": "Anti-Rabies Vaccine", "brands": ["Rabipur", "Verorab", "Abhayrab"], "cls": "Vaccine", "cat": "Prophylaxis", "adult": "1 ml IM Days 0,3,7,14,28", "ped": "Same as adult", "route": "IM", "freq": "Day 0,3,7,14,28", "dur": "28-day course", "str": "1 ml/dose", "form": "Injection", "line": "First line", "notes": "Mandatory for dog/cat bite Category II/III"},
            {"drug": "Mupirocin", "brands": ["Bactroban", "T-Bact"], "cls": "Topical Antibiotic", "cat": "Topical Antibiotic", "adult": "Apply LA BD", "ped": "Same", "route": "Topical", "freq": "BD", "dur": "7-10 days", "str": "2% ointment", "form": "Ointment", "line": "Adjuvant", "notes": "Small wounds; cover with dressing"},
            {"drug": "Diclofenac", "brands": ["Voveran", "Voltaren", "Diclomol"], "cls": "NSAID", "cat": "Analgesic", "adult": "50 mg BD", "ped": "1-3 mg/kg/day divided BD", "route": "Oral", "freq": "BD", "dur": "3-5 days", "str": "50 mg", "form": "Tablet", "line": "Adjuvant", "notes": "After food; add PPI cover"},
        ],
    },
    {
        "name": "Fungal Infection (Tinea / Dermatophytosis)",
        "aliases": ["Tinea", "Ringworm", "Fungal skin infection", "Dermatophytosis", "Fungal"],
        "category": "Dermatology",
        "icd_code": "B35",
        "regimens": [
            {"drug": "Itraconazole", "brands": ["Canditral", "Sporanox", "Itaspor"], "cls": "Triazole Antifungal", "cat": "Antifungal", "adult": "100 mg BD (pulse: 1 week on, 3 weeks off) × 4-8 weeks", "ped": "5 mg/kg/day", "route": "Oral", "freq": "BD", "dur": "4-8 weeks", "str": "100 mg", "form": "Capsule", "line": "First line", "notes": "Take after meal; monitor LFTs if >4 weeks"},
            {"drug": "Fluconazole", "brands": ["Zocon", "Flucos", "Diflucan"], "cls": "Triazole Antifungal", "cat": "Antifungal", "adult": "150 mg weekly", "ped": "6 mg/kg loading, 3 mg/kg weekly", "route": "Oral", "freq": "Weekly", "dur": "4 weeks", "str": "150 mg", "form": "Tablet", "line": "Second line", "notes": "Alternative; good for tinea versicolor"},
            {"drug": "Luliconazole", "brands": ["Lulifin", "Lulican"], "cls": "Azole Antifungal (topical)", "cat": "Topical Antifungal", "adult": "Apply thin layer LA BD", "ped": "Same", "route": "Topical", "freq": "BD", "dur": "2-4 weeks", "str": "1% cream", "form": "Cream", "line": "First line", "notes": "Most effective topical azole; extend 1 cm beyond lesion"},
            {"drug": "Clotrimazole", "brands": ["Candid", "Surfaz", "Canesten"], "cls": "Azole Antifungal (topical)", "cat": "Topical Antifungal", "adult": "Apply LA BD", "ped": "Same", "route": "Topical", "freq": "BD", "dur": "4 weeks", "str": "1% cream", "form": "Cream", "line": "Second line", "notes": "Widely available; good for candidal infections too"},
            {"drug": "Levocetirizine", "brands": ["Xyzal", "Levocet", "Lezyncet"], "cls": "Antihistamine", "cat": "Antihistamine", "adult": "5 mg OD HS", "ped": "2.5 mg OD (<6 yr)", "route": "Oral", "freq": "OD", "dur": "7-14 days", "str": "5 mg", "form": "Tablet", "line": "Adjuvant", "notes": "For itch / pruritus"},
        ],
    },
    {
        "name": "Scabies",
        "aliases": ["Scabies infestation", "Mange"],
        "category": "Dermatology",
        "icd_code": "B86",
        "regimens": [
            {"drug": "Permethrin 5%", "brands": ["Scabper", "Kwellada", "Elimite"], "cls": "Topical Antiparasitic", "cat": "Antiparasitic", "adult": "Apply whole body below neck × 8-12 hrs; wash off; repeat after 1 week", "ped": "Include scalp and face in <2 yr", "route": "Topical", "freq": "Once (repeat at 1 week)", "dur": "2 applications 1 week apart", "str": "5% cream/lotion", "form": "Lotion/Cream", "line": "First line", "notes": "Treat all household contacts simultaneously; wash clothes in hot water"},
            {"drug": "Ivermectin", "brands": ["Ivecop", "Soolantra", "Stromectol"], "cls": "Macrocyclic Lactone", "cat": "Antiparasitic", "adult": "200 mcg/kg single dose; repeat after 1 week", "ped": "Not recommended <15 kg", "route": "Oral", "freq": "Stat (repeat at 1 week)", "dur": "2 doses 1 week apart", "str": "3 mg tablet", "form": "Tablet", "line": "Second line", "notes": "Give on empty stomach; very useful for crusted scabies"},
            {"drug": "Levocetirizine", "brands": ["Xyzal", "Levocet"], "cls": "Antihistamine", "cat": "Antihistamine", "adult": "5 mg OD HS", "ped": "2.5 mg OD", "route": "Oral", "freq": "OD", "dur": "7-14 days", "str": "5 mg", "form": "Tablet", "line": "Adjuvant", "notes": "For post-scabetic itch"},
        ],
    },
    {
        "name": "Iron Deficiency Anaemia",
        "aliases": ["IDA", "Iron deficiency", "Anaemia", "Low haemoglobin"],
        "category": "Haematology",
        "icd_code": "D50",
        "regimens": [
            {"drug": "Ferrous Sulfate + Folic Acid", "brands": ["IFA Tablet (GOI)", "Tardyferon-Folic", "Feronia XT"], "cls": "Iron + Folate supplement", "cat": "Supplement", "adult": "1 tab OD or BD after food", "ped": "IFA syrup: 1 mg/kg elemental iron/day", "route": "Oral", "freq": "OD/BD", "dur": "3 months minimum", "str": "60 mg elemental iron + 500 mcg folic acid", "form": "Tablet", "line": "First line", "notes": "Take after food to reduce GI upset; avoid with tea/milk"},
            {"drug": "Ascorbic Acid", "brands": ["Celin", "Limcee"], "cls": "Vitamin C", "cat": "Supplement", "adult": "500 mg TDS with iron", "ped": "100 mg OD with iron", "route": "Oral", "freq": "TDS", "dur": "3 months", "str": "500 mg", "form": "Tablet", "line": "Adjuvant", "notes": "Enhances non-haem iron absorption"},
            {"drug": "Iron Sucrose", "brands": ["Ferric Plus", "Orofer S"], "cls": "Intravenous Iron", "cat": "Iron supplement", "adult": "200 mg in 100 ml NS IV over 30 min; doses as per deficiency", "ped": "Weight-based per protocol", "route": "IV", "freq": "As per protocol", "dur": "Per total dose calculation", "str": "100 mg/5 ml", "form": "Injection", "line": "Second line", "notes": "For severe anaemia or oral intolerance; refer if possible"},
        ],
    },
    {
        "name": "Acne Vulgaris",
        "aliases": ["Acne", "Pimples", "Acne vulgaris"],
        "category": "Dermatology",
        "icd_code": "L70.0",
        "regimens": [
            {"drug": "Adapalene", "brands": ["Deriva", "Adaferin"], "cls": "Topical Retinoid", "cat": "Topical", "adult": "Apply thin layer LA HS", "ped": ">12 yr: same", "route": "Topical", "freq": "OD (HS)", "dur": "3-6 months", "str": "0.1% gel", "form": "Gel", "line": "First line", "notes": "Apply pea-sized amount; expect peeling in first 2-4 weeks; use SPF"},
            {"drug": "Benzoyl Peroxide", "brands": ["Benzac", "Oxy 10", "Peroxyl"], "cls": "Topical Antibacterial / Keratolytic", "cat": "Topical", "adult": "Apply LA OD-BD", "ped": ">12 yr: same", "route": "Topical", "freq": "OD/BD", "dur": "3-6 months", "str": "2.5% / 5% gel", "form": "Gel", "line": "First line", "notes": "Can bleach fabric; use lower concentration to start"},
            {"drug": "Doxycycline", "brands": ["Doxy 1", "Biodoxi", "Doxt SL"], "cls": "Tetracycline Antibiotic", "cat": "Antibiotic", "adult": "100 mg BD", "ped": ">8 yr: same; not <8 yr", "route": "Oral", "freq": "BD", "dur": "6-12 weeks", "str": "100 mg", "form": "Capsule", "line": "Second line", "notes": "Moderate-severe acne; avoid sunlight; take with food and water"},
            {"drug": "Clindamycin (topical)", "brands": ["Clindac A", "Cleocin T"], "cls": "Topical Antibiotic", "cat": "Topical Antibiotic", "adult": "Apply LA BD", "ped": ">12 yr: same", "route": "Topical", "freq": "BD", "dur": "6-8 weeks", "str": "1% gel/lotion", "form": "Gel", "line": "First line", "notes": "Use with benzoyl peroxide to prevent resistance"},
            {"drug": "Azithromycin (pulse)", "brands": ["Azee", "Zithromax"], "cls": "Macrolide Antibiotic", "cat": "Antibiotic", "adult": "500 mg OD × 3 days/week (pulse therapy)", "ped": ">12 yr: same", "route": "Oral", "freq": "3 days/week", "dur": "4-6 weeks", "str": "500 mg", "form": "Tablet", "line": "Second line", "notes": "Pulse therapy for acne; give after food"},
            {"drug": "Sunscreen SPF 50", "brands": ["Sunstop", "Lacto Calamine SPF", "Neutrogena SPF 50"], "cls": "Sun Protection", "cat": "Topical", "adult": "Apply generously LA OD (reapply 2-3 hrly outdoors)", "ped": ">6 months: SPF 30+", "route": "Topical", "freq": "OD/PRN", "dur": "Daily (ongoing)", "str": "SPF 50", "form": "Lotion/Gel", "line": "Adjuvant", "notes": "Mandatory with all topical retinoids and antibiotics"},
        ],
    },
]


async def auto_seed_drug_reference(engine):
    """Seed drug reference tables if empty. Called from lifespan."""
    async with engine.begin() as conn:
        count = (await conn.execute(text("SELECT COUNT(*) FROM dr_conditions"))).scalar()
        if count and count > 0:
            return

    async with engine.begin() as conn:
        drug_ids: dict[str, str] = {}

        for cond in SEED:
            cid = str(uuid.uuid4())
            await conn.execute(text("""
                INSERT INTO dr_conditions (id, name, aliases, category, icd_code)
                VALUES (:id, :name, :aliases::jsonb, :category, :icd_code)
            """), {
                "id": cid, "name": cond["name"],
                "aliases": json.dumps(cond["aliases"]),
                "category": cond["category"], "icd_code": cond["icd_code"],
            })

            for r in cond["regimens"]:
                drug_key = r["drug"].lower()
                if drug_key not in drug_ids:
                    did = str(uuid.uuid4())
                    await conn.execute(text("""
                        INSERT INTO dr_drugs (id, generic_name, brand_names, drug_class, category)
                        VALUES (:id, :generic_name, :brand_names::jsonb, :drug_class, :category)
                        ON CONFLICT DO NOTHING
                    """), {
                        "id": did, "generic_name": r["drug"],
                        "brand_names": json.dumps(r.get("brands", [])),
                        "drug_class": r.get("cls", ""), "category": r.get("cat", ""),
                    })
                    drug_ids[drug_key] = did
                else:
                    did = drug_ids[drug_key]

                await conn.execute(text("""
                    INSERT INTO dr_regimens
                    (id, condition_id, drug_id, adult_dose, pediatric_dose, route,
                     frequency, duration, strength, formulation, line_of_treatment, notes)
                    VALUES
                    (:id, :cid, :did, :adult, :ped, :route,
                     :freq, :dur, :str, :form, :line, :notes)
                """), {
                    "id": str(uuid.uuid4()), "cid": cid, "did": did,
                    "adult": r.get("adult", ""), "ped": r.get("ped", ""),
                    "route": r.get("route", ""), "freq": r.get("freq", ""),
                    "dur": r.get("dur", ""), "str": r.get("str", ""),
                    "form": r.get("form", ""), "line": r.get("line", "First line"),
                    "notes": r.get("notes", ""),
                })

    print("[drug_reference] Seeded 10 conditions with regimens.")


# ── Read endpoints ────────────────────────────────────────────────────────────

@router.get("/search")
async def search(q: str = "", type: str = "all", category: str = "", db: AsyncSession = Depends(get_db)):
    """Full dataset (q='') for client-side caching, or filtered search."""
    q_like = f"%{q.lower()}%"
    cat_filter = "AND lower(c.category) = lower(:cat)" if category else ""
    cat_params = {"cat": category} if category else {}

    # Conditions query
    if type in ("all", "condition"):
        cond_where = "WHERE 1=1" if not q else f"""
            WHERE (lower(c.name) LIKE :q
                OR c.aliases::text ILIKE :q
                OR lower(c.icd_code) LIKE :q) {cat_filter}
        """
        if not q and category:
            cond_where = f"WHERE {cat_filter.replace('AND ', '')}"
        conditions_rows = (await db.execute(text(f"""
            SELECT c.id, c.name, c.aliases, c.category, c.icd_code, c.notes,
                   COALESCE(
                     json_agg(
                       json_build_object(
                         'id', r.id, 'drug_id', r.drug_id,
                         'generic_name', d.generic_name,
                         'brand_names', d.brand_names, 'drug_class', d.drug_class,
                         'adult_dose', r.adult_dose, 'pediatric_dose', r.pediatric_dose,
                         'route', r.route, 'frequency', r.frequency,
                         'duration', r.duration, 'strength', r.strength,
                         'formulation', r.formulation,
                         'line_of_treatment', r.line_of_treatment,
                         'notes', r.notes, 'contraindications', r.contraindications
                       ) ORDER BY r.line_of_treatment, d.generic_name
                     ) FILTER (WHERE r.id IS NOT NULL), '[]'::json
                   ) AS regimens
            FROM dr_conditions c
            LEFT JOIN dr_regimens r ON r.condition_id = c.id
            LEFT JOIN dr_drugs d ON d.id = r.drug_id
            {cond_where}
            GROUP BY c.id ORDER BY c.name
        """), {"q": q_like, **cat_params})).mappings().all()
    else:
        conditions_rows = []

    # Drugs query
    if type in ("all", "drug"):
        drug_where = "" if not q else "WHERE lower(d.generic_name) LIKE :q OR d.brand_names::text ILIKE :q OR lower(d.drug_class) LIKE :q"
        drugs_rows = (await db.execute(text(f"""
            SELECT d.id, d.generic_name, d.brand_names, d.drug_class, d.category,
                   COALESCE(
                     json_agg(
                       json_build_object(
                         'id', r.id, 'condition_id', r.condition_id,
                         'condition_name', c.name,
                         'adult_dose', r.adult_dose, 'duration', r.duration,
                         'line_of_treatment', r.line_of_treatment
                       ) ORDER BY c.name
                     ) FILTER (WHERE r.id IS NOT NULL), '[]'::json
                   ) AS indications
            FROM dr_drugs d
            LEFT JOIN dr_regimens r ON r.drug_id = d.id
            LEFT JOIN dr_conditions c ON c.id = r.condition_id
            {drug_where}
            GROUP BY d.id ORDER BY d.generic_name
        """), {"q": q_like})).mappings().all()
    else:
        drugs_rows = []

    return {
        "conditions": [dict(r) for r in conditions_rows],
        "drugs": [dict(r) for r in drugs_rows],
    }


@router.get("/conditions")
async def list_conditions(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(text("""
        SELECT c.id, c.name, c.aliases, c.category, c.icd_code, c.notes,
               COUNT(r.id) AS regimen_count
        FROM dr_conditions c
        LEFT JOIN dr_regimens r ON r.condition_id = c.id
        GROUP BY c.id ORDER BY c.name
    """))).mappings().all()
    return [dict(r) for r in rows]


@router.get("/drugs")
async def list_drugs(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(text("""
        SELECT d.id, d.generic_name, d.brand_names, d.drug_class, d.category,
               COUNT(r.id) AS regimen_count
        FROM dr_drugs d
        LEFT JOIN dr_regimens r ON r.drug_id = d.id
        GROUP BY d.id ORDER BY d.generic_name
    """))).mappings().all()
    return [dict(r) for r in rows]


# ── Admin: Conditions ─────────────────────────────────────────────────────────

@router.post("/conditions")
async def create_condition(
    body: ConditionIn, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)
):
    _require_admin(user)
    cid = str(uuid.uuid4())
    await db.execute(text("""
        INSERT INTO dr_conditions (id, name, aliases, category, icd_code, notes)
        VALUES (:id, :name, :aliases::jsonb, :category, :icd_code, :notes)
    """), {"id": cid, "name": body.name, "aliases": json.dumps(body.aliases),
          "category": body.category, "icd_code": body.icd_code, "notes": body.notes})
    await db.commit()
    row = (await db.execute(text("SELECT * FROM dr_conditions WHERE id=:id"), {"id": cid})).mappings().first()
    return dict(row)


@router.put("/conditions/{cid}")
async def update_condition(
    cid: str, body: ConditionIn,
    db: AsyncSession = Depends(get_db), user=Depends(get_current_user)
):
    _require_admin(user)
    await db.execute(text("""
        UPDATE dr_conditions SET name=:name, aliases=:aliases::jsonb, category=:category,
        icd_code=:icd_code, notes=:notes, updated_at=now() WHERE id=:id
    """), {"id": cid, "name": body.name, "aliases": json.dumps(body.aliases),
          "category": body.category, "icd_code": body.icd_code, "notes": body.notes})
    await db.commit()
    row = (await db.execute(text("SELECT * FROM dr_conditions WHERE id=:id"), {"id": cid})).mappings().first()
    if not row:
        raise HTTPException(404)
    return dict(row)


@router.delete("/conditions/{cid}", status_code=204)
async def delete_condition(
    cid: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)
):
    _require_admin(user)
    await db.execute(text("DELETE FROM dr_conditions WHERE id=:id"), {"id": cid})
    await db.commit()


# ── Admin: Drugs ──────────────────────────────────────────────────────────────

@router.post("/drugs")
async def create_drug(
    body: DrugIn, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)
):
    _require_admin(user)
    did = str(uuid.uuid4())
    await db.execute(text("""
        INSERT INTO dr_drugs (id, generic_name, brand_names, drug_class, category)
        VALUES (:id, :generic_name, :brand_names::jsonb, :drug_class, :category)
    """), {"id": did, "generic_name": body.generic_name, "brand_names": json.dumps(body.brand_names),
          "drug_class": body.drug_class, "category": body.category})
    await db.commit()
    row = (await db.execute(text("SELECT * FROM dr_drugs WHERE id=:id"), {"id": did})).mappings().first()
    return dict(row)


@router.put("/drugs/{did}")
async def update_drug(
    did: str, body: DrugIn,
    db: AsyncSession = Depends(get_db), user=Depends(get_current_user)
):
    _require_admin(user)
    await db.execute(text("""
        UPDATE dr_drugs SET generic_name=:generic_name, brand_names=:brand_names::jsonb,
        drug_class=:drug_class, category=:category, updated_at=now() WHERE id=:id
    """), {"id": did, "generic_name": body.generic_name, "brand_names": json.dumps(body.brand_names),
          "drug_class": body.drug_class, "category": body.category})
    await db.commit()
    row = (await db.execute(text("SELECT * FROM dr_drugs WHERE id=:id"), {"id": did})).mappings().first()
    if not row:
        raise HTTPException(404)
    return dict(row)


@router.delete("/drugs/{did}", status_code=204)
async def delete_drug(
    did: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)
):
    _require_admin(user)
    await db.execute(text("DELETE FROM dr_drugs WHERE id=:id"), {"id": did})
    await db.commit()


# ── Admin: Regimens ───────────────────────────────────────────────────────────

@router.post("/regimens")
async def create_regimen(
    body: RegimenIn, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)
):
    _require_admin(user)
    rid = str(uuid.uuid4())
    await db.execute(text("""
        INSERT INTO dr_regimens
        (id, condition_id, drug_id, adult_dose, pediatric_dose, route, frequency,
         duration, strength, formulation, line_of_treatment, notes, contraindications)
        VALUES
        (:id, :cid, :did, :adult_dose, :pediatric_dose, :route, :frequency,
         :duration, :strength, :formulation, :line_of_treatment, :notes, :contraindications)
    """), {
        "id": rid, "cid": body.condition_id, "did": body.drug_id,
        "adult_dose": body.adult_dose, "pediatric_dose": body.pediatric_dose,
        "route": body.route, "frequency": body.frequency, "duration": body.duration,
        "strength": body.strength, "formulation": body.formulation,
        "line_of_treatment": body.line_of_treatment, "notes": body.notes,
        "contraindications": body.contraindications,
    })
    await db.commit()
    row = (await db.execute(text("""
        SELECT r.*, d.generic_name, d.brand_names, d.drug_class
        FROM dr_regimens r JOIN dr_drugs d ON d.id=r.drug_id WHERE r.id=:id
    """), {"id": rid})).mappings().first()
    return dict(row)


@router.put("/regimens/{rid}")
async def update_regimen(
    rid: str, body: RegimenUpdate,
    db: AsyncSession = Depends(get_db), user=Depends(get_current_user)
):
    _require_admin(user)
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(400, "No fields provided")
    set_sql = ", ".join(f"{k}=:{k}" for k in fields)
    fields["id"] = rid
    await db.execute(text(f"UPDATE dr_regimens SET {set_sql}, updated_at=now() WHERE id=:id"), fields)
    await db.commit()
    row = (await db.execute(text("""
        SELECT r.*, d.generic_name, d.brand_names, d.drug_class
        FROM dr_regimens r JOIN dr_drugs d ON d.id=r.drug_id WHERE r.id=:id
    """), {"id": rid})).mappings().first()
    if not row:
        raise HTTPException(404)
    return dict(row)


@router.delete("/regimens/{rid}", status_code=204)
async def delete_regimen(
    rid: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)
):
    _require_admin(user)
    await db.execute(text("DELETE FROM dr_regimens WHERE id=:id"), {"id": rid})
    await db.commit()


# ── CSV import / export ───────────────────────────────────────────────────────

CSV_COLS = [
    "condition_name", "condition_aliases", "condition_category", "condition_icd_code",
    "drug_generic_name", "drug_brand_names", "drug_class",
    "adult_dose", "pediatric_dose", "route", "frequency", "duration",
    "strength", "formulation", "line_of_treatment", "notes", "contraindications",
]


@router.get("/export/csv")
async def export_csv(db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    _require_admin(user)
    rows = (await db.execute(text("""
        SELECT c.name AS condition_name,
               array_to_string(ARRAY(SELECT jsonb_array_elements_text(c.aliases)), ';') AS condition_aliases,
               c.category AS condition_category, c.icd_code AS condition_icd_code,
               d.generic_name AS drug_generic_name,
               array_to_string(ARRAY(SELECT jsonb_array_elements_text(d.brand_names)), ';') AS drug_brand_names,
               d.drug_class,
               r.adult_dose, r.pediatric_dose, r.route, r.frequency, r.duration,
               r.strength, r.formulation, r.line_of_treatment, r.notes, r.contraindications
        FROM dr_regimens r
        JOIN dr_conditions c ON c.id=r.condition_id
        JOIN dr_drugs d ON d.id=r.drug_id
        ORDER BY c.name, r.line_of_treatment, d.generic_name
    """))).mappings().all()
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=CSV_COLS)
    writer.writeheader()
    for row in rows:
        writer.writerow(dict(row))
    buf.seek(0)
    return StreamingResponse(
        io.BytesIO(buf.read().encode()),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=drug_reference.csv"},
    )


@router.post("/import/csv")
async def import_csv(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    _require_admin(user)
    content = (await file.read()).decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(content))
    imported = skipped = 0
    errors: list[str] = []

    for i, row in enumerate(reader, start=2):
        try:
            cname = row.get("condition_name", "").strip()
            dname = row.get("drug_generic_name", "").strip()
            if not cname or not dname:
                skipped += 1
                continue

            # Upsert condition
            c_row = (await db.execute(
                text("SELECT id FROM dr_conditions WHERE lower(name)=lower(:n) LIMIT 1"), {"n": cname}
            )).mappings().first()
            if c_row:
                cid = str(c_row["id"])
            else:
                cid = str(uuid.uuid4())
                aliases = [a.strip() for a in row.get("condition_aliases", "").split(";") if a.strip()]
                await db.execute(text("""
                    INSERT INTO dr_conditions (id, name, aliases, category, icd_code)
                    VALUES (:id, :name, :aliases::jsonb, :cat, :icd)
                """), {"id": cid, "name": cname, "aliases": json.dumps(aliases),
                      "cat": row.get("condition_category", ""), "icd": row.get("condition_icd_code", "")})

            # Upsert drug
            d_row = (await db.execute(
                text("SELECT id FROM dr_drugs WHERE lower(generic_name)=lower(:n) LIMIT 1"), {"n": dname}
            )).mappings().first()
            if d_row:
                did = str(d_row["id"])
            else:
                did = str(uuid.uuid4())
                brands = [b.strip() for b in row.get("drug_brand_names", "").split(";") if b.strip()]
                await db.execute(text("""
                    INSERT INTO dr_drugs (id, generic_name, brand_names, drug_class)
                    VALUES (:id, :name, :brands::jsonb, :cls)
                """), {"id": did, "name": dname, "brands": json.dumps(brands),
                      "cls": row.get("drug_class", "")})

            # Insert regimen
            await db.execute(text("""
                INSERT INTO dr_regimens
                (id, condition_id, drug_id, adult_dose, pediatric_dose, route, frequency,
                 duration, strength, formulation, line_of_treatment, notes, contraindications)
                VALUES
                (:id, :cid, :did, :adult, :ped, :route, :freq, :dur, :str, :form, :line, :notes, :contra)
            """), {
                "id": str(uuid.uuid4()), "cid": cid, "did": did,
                "adult": row.get("adult_dose", ""), "ped": row.get("pediatric_dose", ""),
                "route": row.get("route", ""), "freq": row.get("frequency", ""),
                "dur": row.get("duration", ""), "str": row.get("strength", ""),
                "form": row.get("formulation", ""),
                "line": row.get("line_of_treatment", "First line"),
                "notes": row.get("notes", ""), "contra": row.get("contraindications", ""),
            })
            await db.commit()
            imported += 1
        except Exception as e:
            await db.rollback()
            errors.append(f"Row {i}: {str(e)[:120]}")

    return {"imported": imported, "skipped": skipped, "errors": errors}
