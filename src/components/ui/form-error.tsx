import ui from "./primitives.module.css";

type Props = {
  message: string;
};

// The alert region stays mounted so a failed submit is announced without moving focus.
export function FormError({ message }: Props) {
  return (
    <div role="alert">
      {message && <p className={ui["error-text"]}>{message}</p>}
    </div>
  );
}
