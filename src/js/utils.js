import { UNIX_EPOCH_JULIAN_DATE } from "./constants";

// Asynchronous HTTP (Ajax) request
export function ajaxGet(url, callback) {
  const xhr = new XMLHttpRequest();

  xhr.open("GET", url);
  xhr.onreadystatechange = () => {
    if (xhr.readyState > 3 && xhr.status === 200) {
      callback(xhr.responseText);
    }
  };
  xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest");
  xhr.send();

  return xhr;
}

// Gregorian to Julian date
export function toJED(d) {
  return d / 86400000 + UNIX_EPOCH_JULIAN_DATE;
}

// Julian to Gregorian date
export function fromJED(jed) {
  return new Date(86400000 * (-UNIX_EPOCH_JULIAN_DATE + jed));
}
