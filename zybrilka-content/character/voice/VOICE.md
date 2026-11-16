# Голос Зубра (постоянный)

| Параметр | Значение |
|---|---|
| Движок | Piper TTS 1.x (MIT), офлайн |
| Voice ID | `ru_RU-dmitri-medium` (датасет CC0 — коммерческое использование разрешено) |
| length_scale | 0.96 (норма; быстрее 0.9 — падает разборчивость, проверено ASR) |
| noise_scale / noise_w | 0.7 / 0.9 |
| Обработка | HPF 80 Гц, −2 дБ @250 Гц, +3 дБ @3.5 кГц, компрессор 3:1, loudnorm −14 LUFS |

**Не менять голос между роликами.** Запасной: `ru_RU-denis-medium` (CC0) — ниже тембр, но хуже разборчивость.

## Скачать модели
```bash
B=https://huggingface.co/rhasspy/piper-voices/resolve/main/ru/ru_RU/dmitri/medium
mkdir -p character/voice/models && cd character/voice/models
curl -L -O $B/ru_RU-dmitri-medium.onnx -O $B/ru_RU-dmitri-medium.onnx.json
```

## Ударения и произношение
- Ударение: комбинирующий акут после гласной — `Зубри́лка`, `профи́льной`.
- Полный контроль: фонемы IPA `[[ zubrʲˈilkə ]]`.
- «ЕГЭ» прописными читается как «е-гэ-э» (правильно).
- Проверка: `python3 -c "from piper import PiperVoice; v=PiperVoice.load('…onnx'); print(v.phonemize('текст'))"` — символ `ˈ` стоит перед ударной гласной.
- Обратная проверка: `HF_HUB_DISABLE_XET=1 python3 tools/asr_check.py audio/voiceover.wav`.

## Известные ограничения
Нейро-голос Piper звучит чисто, но эмоциональный диапазон у него умеренный. Whisper иногда слышит финальное «э» в «ЕГЭ» как «я». Если появится бюджет, апгрейд — ElevenLabs через Higgsfield с сохранённым Voice ID.
