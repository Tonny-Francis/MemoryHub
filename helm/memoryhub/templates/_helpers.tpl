{{/*
Expand the name of the chart.
*/}}
{{- define "memoryhub.name" -}}
{{- .Chart.Name }}
{{- end }}

{{/*
Create a fully qualified app name.
*/}}
{{- define "memoryhub.fullname" -}}
{{- printf "%s" .Release.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "memoryhub.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
app.kubernetes.io/name: {{ include "memoryhub.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "memoryhub.selectorLabels" -}}
app.kubernetes.io/name: {{ include "memoryhub.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
