export type Category = {
  id: string;
  name: string;
  color: string;
  is_transfer: number;
  icon: string | null;
};

export type Rule = {
  id: string;
  name: string;
  pattern: string;
  mode: string;
  category_name: string;
  priority: number;
  enabled: number;
  category_color: string;
  category_icon: string | null;
};
