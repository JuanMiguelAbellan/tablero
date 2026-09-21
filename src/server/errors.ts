export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}
export const notFound = () => new HttpError(404, 'No encontrado')
