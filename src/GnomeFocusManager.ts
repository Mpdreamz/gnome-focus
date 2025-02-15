import { Window, WindowActor } from '@imports/Meta-8';
import { FocusSettings } from './settings';
import { BlurEffect } from '@imports/Shell-0.1';

const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;

/** 100% opacity value */
const DEFAULT_OPACITY = 255;

/** Effect that has background blur */
const BLUR_EFFECT_NAME = 'gnome-focus-blur';

/** Window Types that should be considered for focus changes */
const WINDOW_TYPES = [Meta.WindowType.NORMAL];
export function is_valid_window_type(window: Window) {
  return WINDOW_TYPES.includes(window.get_window_type());
}

export class GnomeFocusManager {
  active_window_actor: WindowActor | undefined;
  active_destroy_signal: number | undefined;
  constructor(
    readonly settings: FocusSettings,
    readonly special_focus: string[] | undefined,
    readonly ignore_inactive: string[] | undefined
  ) {
    settings.on('focus-opacity', this.update_focused_window_opacity);
    settings.on('special-opacity', this.update_special_focused_window_opacity);
    settings.on('inactive-opacity', this.update_inactive_windows_opacity);
    settings.on('blur-sigma', this.update_blur_sigma);
    settings.on('is-background-blur', this.update_is_background_blur);
  }

  is_special = (window_actor: WindowActor) => {
    if (!this.special_focus || window_actor.is_destroyed()) {
      return false;
    }

    const window = window_actor.get_meta_window();
    return (
      is_valid_window_type(window) &&
      this.special_focus.some(
        criteria =>
          criteria === window.get_wm_class() ||
          criteria === window.get_wm_class_instance() ||
          criteria === window.get_title()
      )
    );
  };

  is_ignored = (window_actor: WindowActor) => {
    if (window_actor.is_destroyed()) {
      return true;
    }

    if (!this.ignore_inactive) {
      return false;
    }

    const window = window_actor.get_meta_window();
    return (
      !is_valid_window_type(window) ||
      this.ignore_inactive.some(
        criteria =>
          criteria === window.get_wm_class() ||
          criteria === window.get_wm_class_instance() ||
          criteria === window.get_title()
      )
    );
  };

  static set_opacity(window_actor: WindowActor, percentage: number) {
    if (window_actor.is_destroyed()) {
      return;
    }

    const true_opacity = (DEFAULT_OPACITY * percentage) / 100;
    for (const actor of window_actor.get_children()) {
      actor.set_opacity(true_opacity);
    }

    window_actor.set_opacity(true_opacity);
  }

  static set_blur(window_actor: WindowActor, blur: boolean, sigma: number) {
    if (window_actor.is_destroyed() || !is_valid_window_type(window_actor.get_meta_window())) {
      return;
    }

    let blur_effect = (window_actor.get_effect(BLUR_EFFECT_NAME) as unknown) as BlurEffect | null;
    if (blur && null === blur_effect) {
      const blur_effect = Shell.BlurEffect.new();
      blur_effect.set_mode(Shell.BlurMode.BACKGROUND);
      blur_effect.set_sigma(sigma);
      blur_effect.set_enabled(blur);

      // @ts-ignore
      window_actor.add_effect_with_name(BLUR_EFFECT_NAME, blur_effect);
    }

    if (blur_effect) {
      blur_effect.set_sigma(sigma);
      blur_effect.set_enabled(blur);
    }

    if (!blur) {
      window_actor.remove_effect_by_name(BLUR_EFFECT_NAME);
    }
  }

  update_inactive_window_actor = (window_actor: WindowActor) => {
    if (window_actor.is_destroyed() || this.is_ignored(window_actor)) {
      return;
    }

    GnomeFocusManager.set_opacity(window_actor, this.settings.inactive_opacity);
    GnomeFocusManager.set_blur(window_actor, this.settings.is_background_blur, this.settings.blur_sigma);
  };

  set_active_window_actor = (window_actor: WindowActor) => {
    if (this.active_window_actor === window_actor) {
      return;
    }

    if (this.active_window_actor) {
      this.update_inactive_window_actor(this.active_window_actor);
      if (this.active_destroy_signal) {
        this.active_window_actor.disconnect(this.active_destroy_signal);
        delete this.active_destroy_signal;
      }
    }

    if (window_actor.is_destroyed() || this.is_ignored(window_actor)) {
      delete this.active_window_actor;
      return;
    }

    this.active_window_actor = window_actor;
    const opacity = this.is_special(this.active_window_actor)
      ? this.settings.special_focus_opacity
      : this.settings.focus_opacity;

    GnomeFocusManager.set_opacity(this.active_window_actor, opacity);
    GnomeFocusManager.set_blur(this.active_window_actor, this.settings.is_background_blur, this.settings.blur_sigma);

    this.active_destroy_signal = this.active_window_actor.connect('destroy', actor => {
      if (this.active_window_actor === actor) {
        delete this.active_window_actor;
        delete this.active_destroy_signal;
      }
    });
  };

  update_special_focused_window_opacity = (value: number) => {
    if (undefined === this.active_window_actor || !this.is_special(this.active_window_actor)) {
      return;
    }

    GnomeFocusManager.set_opacity(this.active_window_actor, value);
  };

  update_focused_window_opacity = (value: number) => {
    if (undefined === this.active_window_actor || this.is_special(this.active_window_actor)) {
      return;
    }

    GnomeFocusManager.set_opacity(this.active_window_actor, value);
  };

  update_inactive_windows_opacity = (value: number) => {
    for (const window_actor of global.get_window_actors()) {
      if (window_actor === this.active_window_actor || this.is_ignored(window_actor)) {
        continue;
      }

      GnomeFocusManager.set_opacity(window_actor, value);
    }
  };

  update_is_background_blur = (blur: boolean) => {
    const sigma = this.settings.blur_sigma;
    for (const window_actor of global.get_window_actors()) {
      if (this.is_ignored(window_actor)) {
        continue;
      }

      GnomeFocusManager.set_blur(window_actor, blur, sigma);
    }
  };

  update_blur_sigma = (sigma: number) => {
    for (const window_actor of global.get_window_actors()) {
      if (this.is_ignored(window_actor)) {
        continue;
      }

      GnomeFocusManager.set_blur(window_actor, this.settings.is_background_blur, sigma);
    }
  };

  disable() {
    this.settings.clear();
    for (const window_actor of global.get_window_actors()) {
      GnomeFocusManager.set_opacity(window_actor, 100);
      GnomeFocusManager.set_blur(window_actor, false, 0);
    }
  }
}
