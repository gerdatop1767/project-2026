import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MathAnswerField } from './MathAnswerField.js';

/** The component restores the cursor position on the next animation
 * frame (so it applies after React has committed the new value to the
 * DOM — see MathAnswerField.tsx's own comment). A real keypress right
 * after a button click is always well past that ~16ms frame, but a
 * test's next `userEvent` call can run before it, so tests that keep
 * typing after a keyboard-button click wait for it explicitly. */
async function nextFrame() {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

/** Controlled wrapper — `MathAnswerField` takes value/onChange like a real caller (TaskDesktop/TaskMobile), not internal state. */
function ControlledField(props: { initial?: string }) {
  const [value, setValue] = useState(props.initial ?? '');
  return (
    <MathAnswerField value={value} onChange={setValue} ariaLabel="Ответ" placeholder="Ответ..." />
  );
}

describe('MathAnswerField', () => {
  it('renders a plain text input that accepts normal typing', async () => {
    const user = userEvent.setup();
    render(<ControlledField />);
    const input = screen.getByLabelText('Ответ');
    await user.type(input, '-4');
    expect(input).toHaveValue('-4');
  });

  it('the math panel is collapsed until the fx button is toggled', () => {
    render(<ControlledField />);
    expect(screen.queryByRole('button', { name: 'π' })).not.toBeInTheDocument();
  });

  it('opens the math panel and inserts π at the end of an empty field', async () => {
    const user = userEvent.setup();
    render(<ControlledField />);
    await user.click(screen.getByRole('button', { name: 'Математические символы' }));
    await user.click(screen.getByRole('button', { name: 'π' }));
    expect(screen.getByLabelText('Ответ')).toHaveValue('π');
  });

  it('inserts the minus key as a plain ASCII "-", not the unicode "−" glyph — the answer checker matches exact characters', async () => {
    const user = userEvent.setup();
    render(<ControlledField />);
    await user.click(screen.getByRole('button', { name: 'Математические символы' }));
    await user.click(screen.getByRole('button', { name: 'минус' }));
    await user.click(screen.getByRole('button', { name: 'π' }));
    const input = screen.getByLabelText('Ответ') as HTMLInputElement;
    expect(input.value).toBe('-π');
    expect(input.value.includes('−')).toBe(false);
  });

  it('a student can quickly build "-4π; -3π; -8π/3" using typing + keyboard together', async () => {
    const user = userEvent.setup();
    render(<ControlledField />);
    const input = screen.getByLabelText('Ответ');
    await user.click(screen.getByRole('button', { name: 'Математические символы' }));
    await user.type(input, '-4');
    await user.click(screen.getByRole('button', { name: 'π' }));
    await nextFrame();
    await user.type(input, '; -3');
    await user.click(screen.getByRole('button', { name: 'π' }));
    await nextFrame();
    await user.type(input, '; -8');
    await user.click(screen.getByRole('button', { name: 'π' }));
    await nextFrame();
    await user.click(screen.getByRole('button', { name: '/' }));
    await nextFrame();
    await user.type(input, '3');
    expect(input).toHaveValue('-4π; -3π; -8π/3');
  });

  it('inserts a fraction slash literally, matching real correctAnswer conventions (e.g. "36/25")', async () => {
    const user = userEvent.setup();
    render(<ControlledField />);
    const input = screen.getByLabelText('Ответ');
    await user.click(screen.getByRole('button', { name: 'Математические символы' }));
    await user.type(input, '1');
    await user.click(screen.getByRole('button', { name: '/' }));
    await user.type(input, '2');
    expect(input).toHaveValue('1/2');
  });

  it('inserts √ bare, ready for the radicand to be typed right after', async () => {
    const user = userEvent.setup();
    render(<ControlledField />);
    const input = screen.getByLabelText('Ответ');
    await user.click(screen.getByRole('button', { name: 'Математические символы' }));
    await user.click(screen.getByRole('button', { name: '√' }));
    await user.type(input, '3');
    expect(input).toHaveValue('√3');
  });

  it('inserts sin( ) with the cursor left between the parens, not after them', async () => {
    const user = userEvent.setup();
    render(<ControlledField />);
    const input = screen.getByLabelText('Ответ') as HTMLInputElement;
    await user.click(screen.getByRole('button', { name: 'Математические символы' }));
    await user.click(screen.getByRole('button', { name: 'sin' }));
    await screen.findByDisplayValue('sin()');
    await waitFor(() => expect(input.selectionStart).toBe(4));
    // userEvent tracks its own cursor model per element, which can
    // diverge from a selection set by code outside its interaction
    // layer (here, the component's own RAF-deferred restore) — telling
    // it the starting selection explicitly is how a real keypress at
    // that exact cursor position is expressed in this version of
    // userEvent, not a workaround for a bug in the component itself.
    await user.type(input, 'x', { initialSelectionStart: 4, initialSelectionEnd: 4 });
    expect(input.value).toBe('sin(x)');
  });

  it('inserts a math symbol in the middle of existing text at the cursor, not always at the end', async () => {
    const user = userEvent.setup();
    render(<ControlledField initial="x=5" />);
    const input = screen.getByLabelText('Ответ') as HTMLInputElement;
    input.setSelectionRange(1, 1); // right after "x="... actually right after "x", before "=5"
    await user.click(screen.getByRole('button', { name: 'Математические символы' }));
    await user.click(screen.getByRole('button', { name: '²' }));
    expect(input.value).toBe('x²=5');
  });

  it('a selected range is replaced by the inserted symbol, not left alongside it', async () => {
    const user = userEvent.setup();
    render(<ControlledField initial="abc" />);
    const input = screen.getByLabelText('Ответ') as HTMLInputElement;
    input.setSelectionRange(0, 3);
    await user.click(screen.getByRole('button', { name: 'Математические символы' }));
    await user.click(screen.getByRole('button', { name: 'π' }));
    expect(input.value).toBe('π');
  });

  it('backspace and normal editing keep working on a value built via the keyboard', async () => {
    const user = userEvent.setup();
    render(<ControlledField />);
    const input = screen.getByLabelText('Ответ');
    await user.click(screen.getByRole('button', { name: 'Математические символы' }));
    await user.click(screen.getByRole('button', { name: 'π' }));
    await user.click(input);
    await user.keyboard('{End}{Backspace}');
    expect(input).toHaveValue('');
  });

  it('is disabled when disabled is passed, same as a plain input', () => {
    render(
      <MathAnswerField value="" onChange={() => {}} ariaLabel="Ответ" disabled placeholder="" />,
    );
    expect(screen.getByLabelText('Ответ')).toBeDisabled();
  });

  describe('long answers (audit of every published answer)', () => {
    const LONG = [
      '(-4√65;-√290) ∪ (-12√2;-8√2) ∪ (8√2;12√2) ∪ (√290;4√65)',
      'a∈(-2-arccos(0.6)/(6π);-2+arccos(0.6)/(6π)]∪[2-arccos(0.6)/(6π);2+arccos(0.6)/(6π))',
      '-35π/12; -23π/8; -21π/8; -31π/12; -19π/8; -17π/8',
      '30067/3661',
      '-0,75',
      'предпосылкой',
    ];

    it.each(LONG)('keeps the whole answer in one wrapping field: %s', async (answer) => {
      render(<MathAnswerField value={answer} onChange={() => {}} ariaLabel="Ответ" />);
      const field = screen.getByLabelText('Ответ');
      // A growing textarea, not a one-line input that hides the rest.
      expect(field.tagName).toBe('TEXTAREA');
      expect(field).toHaveAttribute('rows', '1');
      expect(field).toHaveValue(answer);
    });

    it('stays ONE answer line: Enter adds nothing, pasted line breaks become spaces', async () => {
      const user = userEvent.setup();
      render(<ControlledField />);
      const field = screen.getByLabelText('Ответ');
      await user.type(field, '1{Enter}2');
      expect(field).toHaveValue('12');
      await user.clear(field);
      await user.click(field);
      await user.paste('(1;2)\n∪ (3;4)');
      expect(field).toHaveValue('(1;2) ∪ (3;4)');
    });
  });
});
