export async function request(path, options = {}) {
  const response = await fetch(path, options);
  if (!response.ok) {
    let message = `请求失败（${response.status}）`;
    try {
      const data = await response.json();
      message = data.error?.message || data.error || data.message || message;
    } catch {}
    throw new Error(message);
  }
  return response;
}

export async function requestJson(path, options = {}) {
  return (await request(path, options)).json();
}
