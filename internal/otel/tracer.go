package otel

import (
	"context"
	"log"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/exporters/stdout/stdouttrace"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	"go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.4.0"
)

var Tracer = otel.Tracer("alcoves")

func getExporter() (trace.SpanExporter, error) {
	var isDev = true
	if isDev {
		exporter, err := stdouttrace.New(stdouttrace.WithPrettyPrint())
		if err != nil {
			log.Fatal(err)
		}
		return exporter, nil
	} else {
		exporter, err := otlptrace.New(
			context.Background(),
			otlptracegrpc.NewClient(
				otlptracegrpc.WithInsecure(),
				otlptracegrpc.WithEndpoint("localhost:4317"),
			),
		)
		if err != nil {
			log.Fatal(err)
		}
		return exporter, nil
	}
}

func InitTracer() *trace.TracerProvider {
	// https://signoz.io/docs/instrumentation/opentelemetry-golang/
	// https://github.com/gofiber/contrib/blob/main/otelfiber/example/server.go

	// var secureOption otlptracegrpc.Option

	// if strings.ToLower(insecure) == "false" || insecure == "0" || strings.ToLower(insecure) == "f" {
	// 	secureOption = otlptracegrpc.WithTLSCredentials(credentials.NewClientTLSFromCert(nil, ""))
	// } else {
	// 	secureOption = otlptracegrpc.WithInsecure()
	// }

	// var secureOption = otlptracegrpc.WithInsecure()

	exporter, err := getExporter()
	if err != nil {
		log.Fatal(err)
	}

	tp := trace.NewTracerProvider(
		trace.WithSampler(trace.AlwaysSample()),
		trace.WithBatcher(exporter),
		trace.WithResource(
			resource.NewWithAttributes(
				semconv.SchemaURL,
				semconv.ServiceNameKey.String("alcoves"),
			)),
	)
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{}))
	return tp
}
