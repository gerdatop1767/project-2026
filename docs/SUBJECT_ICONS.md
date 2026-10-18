# Subject icons and their motion

The nine approved artworks (from `Zybrilka_subject_icons_FIXED1.zip`) are the
only subject pictures in the app. **The file name decides the subject.**

| File | Subject | App id | SHA-256 of the approved original |
| --- | --- | --- | --- |
| `01_Mathematics.png` | Математика | `math` | `5aa0cbf3a15480d71c473c1aef3066805a068f8ef7ee3465539d736e1d0c2fa5` |
| `02_Russian_Language.png` | Русский язык | `russian` | `7228470c398fc073dd33abd54e169a51d70cc1b235f36547b8924e54de29172c` |
| `03_English_Language.png` | Английский язык | `english` | `1ccfcc721e4549041ecbad0c2f6a1ef09cb83dc68696035dfd910ef251fbd16d` |
| `04_Social_Studies.png` | Обществознание | `social` | `e05b6de7fc8687bc0460f3667db85df247206b160e9df45f6d43509833fdcd85` |
| `05_Informatics.png` | Информатика | `informatics` | `63ef09c700e84c8f1146ff2814326503cf66821b5f3a36fd8538c9ab48b1217d` |
| `06_Physics.png` | Физика | `physics` | `9a5b019008404d9dd6793ba8941468bcada92993a2f8cf7ad741a9754c465f63` |
| `07_Chemistry.png` | Химия | `chemistry` | `a0a303afc64478a47057fa707a3bdd5ee59738405c07165a2a8a35dcdcbb82fd` |
| `08_Biology.png` | Биология | `biology` | `1df0d0f4adf6f0fcccc53693f3cbc0162cf245435878c932930f35e185eedd6a` |
| `09_History.png` | История | `history` | `516c081451dad98fa5c38b24df8041f4cdbeecef897584276edaa7ffd0c285ce` |

## Files

`apps/web/public/branding/v2/subject-icons/` holds the pictures **at 512×512**
(RGBA PNG, lossless, optimized) — the approved originals are 1254×1254 and
2–3 MB each, which is far more than a 32–144 px icon needs (≈3.2 MB for all
nine instead of ≈24 MB). The artwork is not redrawn or recoloured; only the
pixel size changes (Lanczos downscale). The originals are not stored in the
repository; the SHA-256 column identifies them. To regenerate the copies from
the originals:

```python
from PIL import Image
im = Image.open("01_Mathematics.png").convert("RGBA").resize((512, 512), Image.LANCZOS)
im.save("01_Mathematics.png", "PNG", optimize=True)
```

The previous set in `public/branding/v2/subjects/` is no longer referenced by
any code; it was left in place (nothing was deleted) and can be removed.

## Code

- `ui/SubjectIcon/subjectIcons.ts` — the only table connecting file names to
  subject ids, plus each icon's own glow colour.
- `ui/SubjectIcon/SubjectIcon.tsx` — the component every screen uses
  (Home, Subjects catalog, Learning center, Subject page, Onboarding,
  Statistics picker, Profile, task header, menu via `SubjectTile`).
- Hover/press react to the icon or to the nearest ancestor with
  `data-subject-interactive` (put it on a whole card to make a tap anywhere on
  it give feedback).

## Motion (all `transform` / `opacity`)

| State | Behaviour |
| --- | --- |
| Idle | A very soft halo in the icon's own colour, breathing slowly (opacity only). |
| Hover (fine pointers only) | scale 1.04, 3 px lift, stronger halo, ~260 ms ease. |
| Press / tap (every pointer) | scale 0.97 in ~110 ms, smooth return. |
| Selected | Steady halo plus a thin luminous outline; readable without any animation. Used on the open subject page and on chosen subjects in onboarding / the statistics picker. |
| Scroll into view | opacity 0→1, translateY 10 px→0, scale .96→1; neighbours staggered 65 ms (capped at 4 steps so a late scroll-in is never sluggish). Needs `IntersectionObserver`; without it, the icon is simply visible. |
| Pointer parallax | ≤ 4 px drift toward the mouse on the larger icons (desktop catalog, subject hero), fine pointers only, one rAF per frame. |
| `prefers-reduced-motion` | No breathing, no reveal, no hover/press scaling, no parallax; the glow stays, static. |

Touch screens never use hover: they get the press feedback and the scroll
reveal only.
