BUILD   := build/
OBJECT  := $(BUILD)utility-wrapper
VERSION := $(shell date +%Y%m%d%H%M%S)
DESTDIR := /usr/local/bin

all: $(OBJECT)

clean:
	rm -rf $(BUILD)
	rm -f $(GEN)

$(OBJECT): src/*.ts
	deno task compile

install:
	mkdir -p $(DESTDIR)
	cp -v $(BUILD)* $(DESTDIR)/
	VERSION=$(VERSION) $(OBJECT) generate $(DESTDIR)/
