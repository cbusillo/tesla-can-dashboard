import type { JSX as IonicJSX } from "@ionic/core";
import type { JSX as IconsJSX } from "ionicons";
import type { ComponentChildren, Ref, JSX as PreactJSX } from "preact";
// Preact preserves custom-event case: onionChange listens for ionChange.
type NativeEvents<T> = T & {
  [
    K in keyof T as K extends `on${infer E}` ? `on${Uncapitalize<E>}` : never
  ]: T[K];
};
type ElementProps<T, E extends HTMLElement> = NativeEvents<
  Omit<T, "children" | "ref">
> &
  Omit<PreactJSX.HTMLAttributes<E>, keyof T | "children" | "ref"> & {
    children?: ComponentChildren;
    ref?: Ref<E>;
    class?: string;
    hidden?: boolean;
    "data-testid"?: string;
  };
type Elements = {
  [K in keyof IonicJSX.IntrinsicElements]: ElementProps<
    IonicJSX.IntrinsicElements[K],
    K extends keyof HTMLElementTagNameMap
      ? HTMLElementTagNameMap[K]
      : HTMLElement
  >;
};
declare module "preact" {
  namespace JSX {
    interface IntrinsicElements extends Elements {
      "ion-icon": ElementProps<
        IconsJSX.IntrinsicElements["ion-icon"],
        HTMLIonIconElement
      >;
    }
  }
}
