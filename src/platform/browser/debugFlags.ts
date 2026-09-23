/** Developer analysis view: append `?debug=analysis` to the URL. Not part of the normal UI. */
export function isAnalysisDebugEnabled(): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).get('debug') === 'analysis';
}
