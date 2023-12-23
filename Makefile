BUILD   := build/
OBJECT  := $(BUILD)utility-wrapper
VERSION := $(shell date +%Y%m%d%H%M%S)
DESTDIR := /usr/local/bin
GEN     := src/generated.ts

all: $(OBJECT)

clean:
	rm -rf $(BUILD)
	rm -f $(GEN)

$(GEN): $(shell ls src/*.ts | grep -v generate)
	cat src/generate.template.ts | sed "s/VERSION/$(VERSION)/g" > src/generated.ts

$(OBJECT): src/*.ts $(GEN)
	deno task compile

install:
	mkdir -p $(DESTDIR)
	cp -v $(BUILD)* $(DESTDIR)/
	$(OBJECT) generate $(DESTDIR)/
