import createSphere from "./createSphere";

export default class Sun {
  static defaultOptions = {
    size: 5,
    segments: 32,
    color: 0xffff00
  };

  constructor(options) {
    this.options = Object.assign({}, Sun.defaultOptions, options);
    this.body = createSphere(this.options);
  }
}
