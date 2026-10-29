FROM public.ecr.aws/docker/library/golang:1.24.13-bookworm AS build

ARG MINIO_VERSION=RELEASE.2025-10-15T17-29-55Z
ARG MC_VERSION=RELEASE.2025-08-13T08-35-41Z

ENV CGO_ENABLED=0

RUN go install github.com/minio/minio@${MINIO_VERSION} \
  && go install github.com/minio/mc@${MC_VERSION}

FROM public.ecr.aws/docker/library/debian:bookworm-slim

COPY --from=build /go/bin/minio /usr/local/bin/minio
COPY --from=build /go/bin/mc /usr/local/bin/mc
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

VOLUME ["/data"]

ENTRYPOINT ["minio"]
CMD ["server", "/data", "--console-address", ":9001"]
