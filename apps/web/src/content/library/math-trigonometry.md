# Тригонометрия: значения, формулы, уравнения

Тригонометрия нужна в **№6** (простые уравнения), **№7** (вычисления) и **№13** (уравнения с отбором корней).

## Значения в основных углах

| $\alpha$ | $0$ | $\frac{\pi}{6}$ | $\frac{\pi}{4}$ | $\frac{\pi}{3}$ | $\frac{\pi}{2}$ | $\pi$ |
|---|---|---|---|---|---|---|
| градусы | 0° | 30° | 45° | 60° | 90° | 180° |
| $\sin\alpha$ | $0$ | $\frac12$ | $\frac{\sqrt2}{2}$ | $\frac{\sqrt3}{2}$ | $1$ | $0$ |
| $\cos\alpha$ | $1$ | $\frac{\sqrt3}{2}$ | $\frac{\sqrt2}{2}$ | $\frac12$ | $0$ | $-1$ |
| $\operatorname{tg}\alpha$ | $0$ | $\frac{\sqrt3}{3}$ | $1$ | $\sqrt3$ | — | $0$ |

## Знаки по четвертям

| Четверть | $\sin$ | $\cos$ | $\operatorname{tg}$ |
|---|---|---|---|
| I ($0$ — $\frac{\pi}{2}$) | + | + | + |
| II ($\frac{\pi}{2}$ — $\pi$) | + | − | − |
| III ($\pi$ — $\frac{3\pi}{2}$) | − | − | + |
| IV ($\frac{3\pi}{2}$ — $2\pi$) | − | + | − |

## Основные формулы

- $\sin^2\alpha + \cos^2\alpha = 1$; $\ \operatorname{tg}\alpha = \frac{\sin\alpha}{\cos\alpha}$; $\ 1 + \operatorname{tg}^2\alpha = \frac{1}{\cos^2\alpha}$.
- $\sin 2\alpha = 2\sin\alpha\cos\alpha$.
- $\cos 2\alpha = \cos^2\alpha - \sin^2\alpha = 2\cos^2\alpha - 1 = 1 - 2\sin^2\alpha$.
- $\sin(\alpha \pm \beta) = \sin\alpha\cos\beta \pm \cos\alpha\sin\beta$.
- $\cos(\alpha \pm \beta) = \cos\alpha\cos\beta \mp \sin\alpha\sin\beta$.

## Формулы приведения — одно правило

1. Если в аргументе $\frac{\pi}{2}$ или $\frac{3\pi}{2}$ — функция меняется на «кофункцию» (sin ↔ cos, tg ↔ ctg); если $\pi$ или $2\pi$ — не меняется.
2. Знак — как у **исходной** функции в той четверти, куда попадает угол (считай $\alpha$ острым).

> [!example] Применение
> $\sin\left(\frac{3\pi}{2} - \alpha\right)$: аргумент с $\frac{3\pi}{2}$ — меняем на $\cos$; угол в III четверти, где синус отрицателен. Ответ: $-\cos\alpha$.

## Простейшие уравнения

| Уравнение | Решение |
|---|---|
| $\sin x = a$, $\lvert a\rvert \le 1$ | $x = \arcsin a + 2\pi k$ и $x = \pi - \arcsin a + 2\pi k$ |
| $\cos x = a$, $\lvert a\rvert \le 1$ | $x = \pm\arccos a + 2\pi k$ |
| $\operatorname{tg} x = a$ | $x = \operatorname{arctg} a + \pi k$ |
| $\sin x = 0$ / $\cos x = 0$ | $x = \pi k$ / $x = \frac{\pi}{2} + \pi k$ |
| $\sin x = 1$ / $\sin x = -1$ | $x = \frac{\pi}{2} + 2\pi k$ / $x = -\frac{\pi}{2} + 2\pi k$ |
| $\cos x = 1$ / $\cos x = -1$ | $x = 2\pi k$ / $x = \pi + 2\pi k$ |

![[trig-selection]] Отбор корней на окружности: отрезок — дуга, корни — точки на ней.

> [!mistake] $\arccos$ отрицательного числа
> $\arccos(-a) = \pi - \arccos a$, а не $-\arccos a$. Например, $\arccos\left(-\frac12\right) = \frac{2\pi}{3}$.

> [!tip] Совет Зубра
> Не знаешь знак — нарисуй окружность и отметь угол. Тридцать секунд на рисунок экономят балл.
